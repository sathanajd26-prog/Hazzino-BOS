/**
 * The gate's decision table. Pure and edge-safe (no node: imports) so the
 * middleware can run it and the tests can cover every branch without a server.
 *
 * Model:
 *   - no password set   → open on this machine only (loopback Host); any other
 *                         Host is refused with 503 until a password exists.
 *   - password set      → every page and API route needs the session cookie.
 *   - always            → mutating cross-origin requests are refused (CSRF).
 *
 * The loopback rule is judged on the Host header, which a remote client can
 * forge. That is why `scripts/serve.mjs` refuses to bind to anything but
 * 127.0.0.1 while no password exists: the network never reaches this code in
 * that state. The Host check is the second layer, for `next dev` run by hand.
 */

export const HAZZINO_SESSION_COOKIE = 'hazzino_session';
export const SESSION_COOKIE = 'glados_session';

/** Reachable without a session: the login page + endpoint, the status probe the
 *  middleware itself calls, and webhooks (which carry their own shared secret). */
export const OPEN_PATHS = ['/login', '/api/auth/login', '/api/auth/logout', '/api/auth/check'] as const;

/** Push endpoints another machine calls with a bearer token instead of a session
 *  (FounderOS merge). Exact paths only. Each route runs lib/push-auth.ts, which
 *  fails closed: no valid token means the same session/loopback rule as here.
 *  /api/trading/limits: GET with the token (the Markets agent reads its limits);
 *  PATCH refuses the token and takes the operator session only. */
export const TOKEN_PATHS = ['/api/trading/snapshot', '/api/trading/limits', '/api/usage/push', '/api/plaud/ingest'] as const;

/**
 * Sanitizes a redirect destination to prevent open-redirect attacks.
 * Disallows protocol-relative URLs (//evil.com), backslashes, colons in path,
 * and external hosts, ensuring the destination is always a relative path on the current origin.
 */
export function sanitizeNextUrl(raw: string | null | undefined): string {
  if (!raw) return '/';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return '/';
  }
  if (/[\r\n\t\0]/.test(trimmed)) {
    return '/';
  }
  const pathPart = trimmed.split('?')[0];
  if (pathPart.includes(':')) {
    return '/';
  }
  return trimmed;
}

export function isOpenPath(pathname: string): boolean {
  return (
    (OPEN_PATHS as readonly string[]).includes(pathname) ||
    (TOKEN_PATHS as readonly string[]).includes(pathname) ||
    pathname.startsWith('/api/webhooks/') ||
    (pathname.startsWith('/api/lab/oauth/') && pathname.endsWith('/callback'))
  );
}

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '::1' ||
    h === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)
  );
}

/**
 * Hostname out of a Host header ("localhost:4100" → "localhost",
 * "[::1]:4100" → "::1"). Self-hosted Next reports its *internal* host on
 * req.nextUrl, so the gate must read the header the browser actually sent.
 */
export function hostnameOf(hostHeader: string | null | undefined): string {
  const h = (hostHeader ?? '').trim();
  if (!h) return '';
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 ? h.slice(1, end) : h;
  }
  const colon = h.lastIndexOf(':');
  // a bare IPv6 literal without brackets has several colons; leave it whole
  return colon > 0 && h.indexOf(':') === colon ? h.slice(0, colon) : h;
}

export function isTrustedProxy(): boolean {
  const v = (process.env.TRUSTED_PROXY || process.env.GLADOS_TRUSTED_PROXY || '').trim().toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  // In production, untrusted by default (fail closed); in test mode, trust unless explicitly disabled
  return process.env.NODE_ENV === 'test';
}

/** The origin the browser believes it is talking to, from the headers a
 *  reverse proxy forwards (only if TRUSTED_PROXY=1) or the Host header. */
export function requestOriginOf(headers: { get(name: string): string | null }): { hostname: string; origin: string } {
  const trusted = isTrustedProxy();
  const host = (trusted ? headers.get('x-forwarded-host') : null) ?? headers.get('host') ?? '';
  const proto = (trusted ? headers.get('x-forwarded-proto') : null) ?? 'http';
  return { hostname: hostnameOf(host), origin: `${proto}://${host}` };
}

/**
 * Validates whether two origins match in protocol and host, case-insensitively.
 */
export function originsMatch(originA: string | null | undefined, originB: string | null | undefined): boolean {
  if (!originA || !originB) return false;
  try {
    const uA = new URL(originA);
    const uB = new URL(originB);
    return uA.protocol === uB.protocol && uA.host.toLowerCase() === uB.host.toLowerCase();
  } catch {
    return originA.trim().toLowerCase() === originB.trim().toLowerCase();
  }
}

/**
 * Names to treat as this machine, from GLADOS_TRUSTED_HOSTS (comma separated).
 *
 * Only consulted while NO password is set, and only to decide "is this request
 * coming from the machine itself". It exists so a filming alias like
 * glados.com, pointed at 127.0.0.1 in /etc/hosts, does not hit the
 * unconfigured-remote 503. Once a password IS set this list is ignored
 * entirely and every host goes through login as before.
 *
 * Only ever put names here that resolve to this machine.
 */
export function parseTrustedHosts(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export type GateInput = {
  pathname: string;
  method: string;
  /** Host the browser asked for (req.nextUrl.hostname). */
  hostname: string;
  /** Origin header of the request, null when the browser sent none. */
  origin: string | null;
  /** The origin this server believes it is (req.nextUrl.origin). */
  requestOrigin: string;
  configured: boolean;
  authed: boolean;
  /** See parseTrustedHosts. Empty unless GLADOS_TRUSTED_HOSTS is set. */
  trustedHosts?: readonly string[];
  /** Optional Referer header for secondary CSRF validation */
  referer?: string | null;
  /** Optional Sec-Fetch-Site header */
  secFetchSite?: string | null;
};

export type GateDecision =
  | { kind: 'pass' }
  | { kind: 'cross-origin' }
  | { kind: 'unauthorized-api' }
  | { kind: 'redirect-login' }
  | { kind: 'unconfigured-remote' };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function decideGate(i: GateInput): GateDecision {
  if (isOpenPath(i.pathname)) return { kind: 'pass' };

  const mutating = !SAFE_METHODS.has(i.method.toUpperCase());
  let crossOrigin = false;
  if (mutating) {
    if (i.secFetchSite === 'cross-site') {
      crossOrigin = true;
    } else if (i.origin !== null && i.origin !== undefined) {
      crossOrigin = !originsMatch(i.origin, i.requestOrigin);
    } else if (i.referer) {
      try {
        const refOrigin = new URL(i.referer).origin;
        crossOrigin = !originsMatch(refOrigin, i.requestOrigin);
      } catch {
        crossOrigin = true;
      }
    }
  }

  if (!i.configured) {
    const host = i.hostname.trim().toLowerCase();
    const local = isLoopbackHost(host) || (i.trustedHosts ?? []).includes(host);
    if (!local) return { kind: 'unconfigured-remote' };
    return crossOrigin ? { kind: 'cross-origin' } : { kind: 'pass' };
  }

  if (i.authed) return crossOrigin ? { kind: 'cross-origin' } : { kind: 'pass' };

  return i.pathname.startsWith('/api/') ? { kind: 'unauthorized-api' } : { kind: 'redirect-login' };
}

export const UNCONFIGURED_REMOTE_MESSAGE =
  'This console has no operator password yet, so it only answers on the machine it runs on. ' +
  'Open it there (http://localhost:<port>/setup) and set a password under Security, then come back.';
