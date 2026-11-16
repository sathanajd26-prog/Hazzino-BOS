import { NextResponse, type NextRequest } from 'next/server';
import {
  HAZZINO_SESSION_COOKIE,
  SESSION_COOKIE,
  UNCONFIGURED_REMOTE_MESSAGE,
  decideGate,
  isOpenPath,
  parseTrustedHosts,
  requestOriginOf,
  sanitizeNextUrl,
} from '@/lib/auth-gate';

/**
 * The gate. With authentication configured, protected pages and APIs require
 * a valid session cookie (hazzino_session or legacy glados_session). With no
 * authentication configured, the console is open on loopback only; remote requests
 * receive a 503 instructing the operator to set up the system.
 *
 * This runs on the edge runtime, so it probes the node-side /api/auth/check endpoint.
 * Page requests may be briefly cached for performance, but /api/ requests bypass
 * the cache to enforce immediate revocation.
 */

const TRUSTED_HOSTS = parseTrustedHosts(process.env.GLADOS_TRUSTED_HOSTS);

const TTL_MS = 10_000;
const CACHE_MAX = 500;
const cache = new Map<string, { configured: boolean; authed: boolean; at: number }>();

function probeOrigin(req: NextRequest): string {
  const host = (process.env.GLADOS_HOST || '127.0.0.1').trim();
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const port = (process.env.PORT || '').trim() || req.nextUrl.port || '4100';
  return `http://${bracketed}:${port}`;
}

async function authStatus(req: NextRequest, isApi: boolean): Promise<{ configured: boolean; authed: boolean }> {
  const hazzinoCookie = req.cookies.get(HAZZINO_SESSION_COOKIE)?.value ?? '';
  const legacyCookie = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const cacheKey = `${hazzinoCookie}:${legacyCookie}`;

  const now = Date.now();
  // Bypass cache for API requests so revoked sessions fail immediately
  if (!isApi) {
    const hit = cache.get(cacheKey);
    if (hit && now - hit.at < TTL_MS) return hit;
  }

  const cookieHeaderParts: string[] = [];
  if (hazzinoCookie) cookieHeaderParts.push(`${HAZZINO_SESSION_COOKIE}=${encodeURIComponent(hazzinoCookie)}`);
  if (legacyCookie) cookieHeaderParts.push(`${SESSION_COOKIE}=${encodeURIComponent(legacyCookie)}`);

  try {
    const res = await fetch(`${probeOrigin(req)}/api/auth/check`, {
      headers: cookieHeaderParts.length > 0 ? { cookie: cookieHeaderParts.join('; ') } : {},
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`check ${res.status}`);
    const body = (await res.json()) as { configured?: unknown; authed?: unknown };
    const result = { configured: body.configured === true, authed: body.authed === true, at: now };
    if (!isApi) {
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(cacheKey, result);
    }
    return result;
  } catch {
    // Fail CLOSED: if probe cannot answer, treat host as configured and locked
    return { configured: true, authed: false };
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isOpenPath(pathname)) return NextResponse.next();

  const { hostname, origin: requestOrigin } = requestOriginOf(req.headers);
  const isApi = pathname.startsWith('/api/');
  const { configured, authed } = await authStatus(req, isApi);
  const decision = decideGate({
    pathname,
    method: req.method,
    hostname,
    origin: req.headers.get('origin'),
    requestOrigin,
    configured,
    authed,
    trustedHosts: TRUSTED_HOSTS,
    referer: req.headers.get('referer'),
    secFetchSite: req.headers.get('sec-fetch-site'),
  });

  switch (decision.kind) {
    case 'pass':
      return NextResponse.next();
    case 'cross-origin':
      return NextResponse.json({ error: 'cross-origin request refused' }, { status: 403 });
    case 'unauthorized-api':
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    case 'unconfigured-remote': {
      const message = UNCONFIGURED_REMOTE_MESSAGE.replace('<port>', (process.env.PORT || '').trim() || req.nextUrl.port || '4100');
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: message }, { status: 503 });
      return new NextResponse(
        `<!doctype html><meta charset="utf-8"><title>Hazzino BOS · System Setup Required</title>` +
          `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#d7d7d9;font:14px/1.6 system-ui,sans-serif">` +
          `<main style="max-width:440px;padding:24px"><h1 style="font-size:15px;font-weight:600;margin:0 0 8px">Hazzino BOS is not reachable from here yet</h1>` +
          `<p style="margin:0;color:#9a9aa0">${message}</p></main>`,
        { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }
    case 'redirect-login': {
      const fullPath = pathname + (req.nextUrl.search || '');
      const safeNext = sanitizeNextUrl(fullPath);
      const search = safeNext === '/' ? '' : `?next=${encodeURIComponent(safeNext)}`;
      return NextResponse.redirect(new URL(`/login${search}`, requestOrigin));
    }
  }
}

export const config = {
  // everything except Next internals and static files (agents/ removed to protect agent setup routes)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|svg|ico|ttf|woff2?)$).*)'],
};
