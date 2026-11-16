import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import {
  closeAuthDb,
  openAuthDb,
} from '@/lib/auth/db';
import {
  createUser,
  recordFailedLogin,
  resetFailedLogins,
  findUserById,
} from '@/lib/auth/users';
import {
  createSession,
} from '@/lib/auth/sessions';
import {
  HAZZINO_SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
  getAuthenticatedUser,
  requireAuth,
  hasIndividualUsers,
  isAuthConfigured,
  setTestRequest,
} from '@/lib/auth/guard';
import {
  decideGate,
  requestOriginOf,
  originsMatch,
  isTrustedProxy,
} from '@/lib/auth-gate';
import { authorizePush } from '@/lib/push-auth';
import { hashPassword } from '@/lib/auth/crypto';
import { clientKey, resetThrottle } from '@/lib/auth';

// Isolated temporary database for remediation test suite
let tmpDir: string;
let testDbPath: string;
const prevAuthDb = process.env.HAZZINO_AUTH_DB;
const prevEnvLocal = process.env.GLADOS_ENV_LOCAL;
const prevTrustedProxy = process.env.TRUSTED_PROXY;

beforeEach(() => {
  resetThrottle();
  closeAuthDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hazzino-remediation-test-'));
  testDbPath = path.join(tmpDir, 'auth.db');
  process.env.HAZZINO_AUTH_DB = testDbPath;
  process.env.GLADOS_ENV_LOCAL = path.join(tmpDir, '.env.local');
  delete process.env.TRUSTED_PROXY;
  openAuthDb(testDbPath);
});

afterAll(() => {
  closeAuthDb();
  if (prevAuthDb === undefined) delete process.env.HAZZINO_AUTH_DB;
  else process.env.HAZZINO_AUTH_DB = prevAuthDb;
  if (prevEnvLocal === undefined) delete process.env.GLADOS_ENV_LOCAL;
  else process.env.GLADOS_ENV_LOCAL = prevEnvLocal;
  if (prevTrustedProxy === undefined) delete process.env.TRUSTED_PROXY;
  else process.env.TRUSTED_PROXY = prevTrustedProxy;
});

describe('Phase 5D-2R: Security Remediation', () => {
  describe('Fix 1: Legacy Authentication Bypass Prevention', () => {
    test('when individual users exist, legacy glados_session cookie is strictly rejected', async () => {
      // 1. Setup legacy credentials in .env.local
      const legacySecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      fs.writeFileSync(
        process.env.GLADOS_ENV_LOCAL!,
        `GLADOS_PASSWORD_HASH=scrypt:16384:8:1:salt:key\nGLADOS_SESSION_SECRET=${legacySecret}\n`,
      );

      // 2. Add an individual user
      createUser({
        name: 'Sarah Connor',
        email: 'sarah@hazzino.com',
        role: 'employee',
        password: 'Password123!',
      });

      expect(hasIndividualUsers()).toBe(true);
      expect(isAuthConfigured()).toBe(true);

      // 3. Attempt access with legacy cookie
      const req = new Request('http://localhost/api/agents', {
        headers: { cookie: `${LEGACY_SESSION_COOKIE}=${legacySecret}` },
      });

      const authed = getAuthenticatedUser(req);
      expect(authed).toBeNull();

      // 4. Check probe route /api/auth/check
      const { GET: checkGet } = await import('@/app/api/auth/check/route');
      const checkRes = await checkGet(req);
      const checkBody = await checkRes.json();
      expect(checkBody.authed).toBe(false);

      // 5. Attempt legacy login via /api/auth/login without email
      const { POST: loginPost } = await import('@/app/api/auth/login/route');
      const legacyLoginReq = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'any-password' }),
      });
      const loginRes = await loginPost(legacyLoginReq);
      expect(loginRes.status).toBe(400);

      // 6. Attempt legacy password route
      const { POST: passwordPost } = await import('@/app/api/auth/password/route');
      const legacyPassReq = new Request('http://localhost/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set', password: 'NewPassword123!' }),
      });
      const passRes = await passwordPost(legacyPassReq);
      expect(passRes.status).toBe(403);
    });

    test('when no individual users exist yet, legacy operator fallback prevents lockout during migration', async () => {
      // No users in auth.db
      expect(hasIndividualUsers()).toBe(false);

      const legacySecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      fs.writeFileSync(
        process.env.GLADOS_ENV_LOCAL!,
        `GLADOS_PASSWORD_HASH=scrypt:16384:8:1:salt:key\nGLADOS_SESSION_SECRET=${legacySecret}\n`,
      );

      const req = new Request('http://localhost/api/agents', {
        headers: { cookie: `${LEGACY_SESSION_COOKIE}=${legacySecret}` },
      });

      const authed = getAuthenticatedUser(req);
      expect(authed).not.toBeNull();
      expect(authed?.user.id).toBe('legacy-operator');
    });
  });

  describe('Fix 2: Server-Side Defense-in-Depth Across Protected Routes', () => {
    test('protected route handlers reject unauthenticated requests with 401 when configured', async () => {
      const user = createUser({
        name: 'Sec Ops',
        email: 'secops@hazzino.com',
        role: 'super_admin',
        password: 'Password123!',
      });
      expect(isAuthConfigured()).toBe(true);

      // Test 0-argument route (uses next/headers or setTestRequest)
      const { GET: getAgents } = await import('@/app/api/agents/route');
      const { GET: getClients } = await import('@/app/api/clients/route');

      // Unauthenticated requests
      setTestRequest(new Request('http://localhost/api/agents'));
      const resAgents = await getAgents();
      expect(resAgents.status).toBe(401);

      // Unauthenticated request on route with explicit req param
      const unauthedClientRes = await getClients(new Request('http://localhost/api/clients'));
      expect(unauthedClientRes.status).toBe(401);

      // Authenticated with valid session
      const { rawToken } = createSession({ userId: user.id });

      setTestRequest(new Request('http://localhost/api/agents', {
        headers: { cookie: `${HAZZINO_SESSION_COOKIE}=${rawToken}` },
      }));
      const authedRes = await getAgents();
      expect(authedRes.status).toBe(200);
      const data = await authedRes.json();
      expect(Array.isArray(data.agents)).toBe(true);
      setTestRequest(null);

      // Authenticated with explicit req param
      const authedClientReq = new Request('http://localhost/api/clients', {
        headers: { cookie: `${HAZZINO_SESSION_COOKIE}=${rawToken}` },
      });
      const authedClientRes = await getClients(authedClientReq);
      expect(authedClientRes.status).toBe(200);
    });
  });

  describe('Fix 3: CSRF, Proxy Headers and Host Spoofing', () => {
    test('CSRF protection blocks mutating requests with cross-site fetch metadata or mismatched origin', () => {
      // 1. Sec-Fetch-Site: cross-site is immediately refused
      const decision1 = decideGate({
        pathname: '/api/keys',
        method: 'POST',
        hostname: 'localhost',
        origin: 'http://localhost:4100',
        requestOrigin: 'http://localhost:4100',
        configured: true,
        authed: true,
        secFetchSite: 'cross-site',
      });
      expect(decision1.kind).toBe('cross-origin');

      // 2. Mismatched Origin is refused
      const decision2 = decideGate({
        pathname: '/api/keys',
        method: 'POST',
        hostname: 'localhost',
        origin: 'http://evil.com',
        requestOrigin: 'http://localhost:4100',
        configured: true,
        authed: true,
      });
      expect(decision2.kind).toBe('cross-origin');

      // 3. Mismatched Referer when Origin is omitted is refused
      const decision3 = decideGate({
        pathname: '/api/keys',
        method: 'POST',
        hostname: 'localhost',
        origin: null,
        requestOrigin: 'http://localhost:4100',
        configured: true,
        authed: true,
        referer: 'http://evil.com/phishing',
      });
      expect(decision3.kind).toBe('cross-origin');

      // 4. Matching Origin succeeds
      const decision4 = decideGate({
        pathname: '/api/keys',
        method: 'POST',
        hostname: 'localhost',
        origin: 'http://localhost:4100',
        requestOrigin: 'http://localhost:4100',
        configured: true,
        authed: true,
      });
      expect(decision4.kind).toBe('pass');
    });

    test('X-Forwarded-Host is ignored unless TRUSTED_PROXY is explicitly enabled', () => {
      process.env.TRUSTED_PROXY = '0';
      expect(isTrustedProxy()).toBe(false);

      const headers = new Headers({
        host: 'real-server.internal:4100',
        'x-forwarded-host': 'spoofed-domain.com',
        'x-forwarded-proto': 'https',
      });

      const { hostname, origin } = requestOriginOf(headers);
      expect(hostname).toBe('real-server.internal');
      expect(origin).toBe('http://real-server.internal:4100');

      // Now enable trusted proxy
      process.env.TRUSTED_PROXY = '1';
      expect(isTrustedProxy()).toBe(true);

      const trustedResult = requestOriginOf(headers);
      expect(trustedResult.hostname).toBe('spoofed-domain.com');
      expect(trustedResult.origin).toBe('https://spoofed-domain.com');

      delete process.env.TRUSTED_PROXY;
    });

    test('clientKey ignores X-Forwarded-For unless TRUSTED_PROXY is enabled', () => {
      process.env.TRUSTED_PROXY = '0';
      const req = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '198.51.100.25' },
      });
      expect(clientKey(req)).toBe('local');

      process.env.TRUSTED_PROXY = 'true';
      expect(clientKey(req)).toBe('198.51.100.25');
      delete process.env.TRUSTED_PROXY;
    });
  });

  describe('Fix 4: Dedicated Machine Tokens for M2M Endpoints', () => {
    test('unauthenticated loopback requests cannot push without a token', () => {
      process.env.TRADING_PUSH_TOKEN = 'market-token-abc';
      const loopbackReq = new Request('http://127.0.0.1:4100/api/trading/snapshot', {
        method: 'POST',
      });
      const auth = authorizePush(loopbackReq, 'TRADING_PUSH_TOKEN');
      expect(auth.ok).toBe(false);
      if (!auth.ok) {
        expect(auth.status).toBe(401);
      }
      delete process.env.TRADING_PUSH_TOKEN;
    });

    test('low-privilege employee session cannot push without dedicated token', () => {
      process.env.TRADING_PUSH_TOKEN = 'market-token-abc';
      const employee = createUser({
        name: 'Junior Dev',
        email: 'dev@hazzino.com',
        role: 'employee',
        password: 'Password123!',
      });
      const { rawToken } = createSession({ userId: employee.id });

      const req = new Request('http://localhost/api/trading/snapshot', {
        method: 'POST',
        headers: { cookie: `${HAZZINO_SESSION_COOKIE}=${rawToken}` },
      });
      const auth = authorizePush(req, 'TRADING_PUSH_TOKEN');
      expect(auth.ok).toBe(false);
      if (!auth.ok) {
        expect(auth.status).toBe(403);
      }
      delete process.env.TRADING_PUSH_TOKEN;
    });

    test('super_admin session or valid bearer token can push', () => {
      process.env.TRADING_PUSH_TOKEN = 'market-token-abc';
      const admin = createUser({
        name: 'Chief Admin',
        email: 'admin@hazzino.com',
        role: 'super_admin',
        password: 'Password123!',
      });
      const { rawToken } = createSession({ userId: admin.id });

      // Admin session succeeds
      const adminReq = new Request('http://localhost/api/trading/snapshot', {
        method: 'POST',
        headers: { cookie: `${HAZZINO_SESSION_COOKIE}=${rawToken}` },
      });
      expect(authorizePush(adminReq, 'TRADING_PUSH_TOKEN')).toEqual({ ok: true, via: 'session' });

      // Bearer token succeeds
      const tokenReq = new Request('http://localhost/api/trading/snapshot', {
        method: 'POST',
        headers: { Authorization: 'Bearer market-token-abc' },
      });
      expect(authorizePush(tokenReq, 'TRADING_PUSH_TOKEN')).toEqual({ ok: true, via: 'token' });

      delete process.env.TRADING_PUSH_TOKEN;
    });
  });

  describe('Fix 5: Atomic Account Lockout & Throttling', () => {
    test('failed login attempts atomically increment and lock at threshold', () => {
      const user = createUser({
        name: 'Bob Lockout',
        email: 'bob@hazzino.com',
        role: 'employee',
        password: 'Password123!',
      });

      // 4 failures
      for (let i = 1; i <= 4; i++) {
        const res = recordFailedLogin(user.id);
        expect(res.failedAttempts).toBe(i);
        expect(res.lockedUntil).toBeNull();
      }

      // 5th failure triggers lockout
      const lockRes = recordFailedLogin(user.id, 900);
      expect(lockRes.failedAttempts).toBe(5);
      expect(lockRes.lockedUntil).toBeGreaterThan(Date.now());

      const userAfter = findUserById(user.id);
      expect(userAfter?.failedAttempts).toBe(5);
      expect(userAfter?.lockedUntil).toBeGreaterThan(Date.now());

      // Reset unlocks
      resetFailedLogins(user.id);
      const userReset = findUserById(user.id);
      expect(userReset?.failedAttempts).toBe(0);
      expect(userReset?.lockedUntil).toBeNull();
    });
  });
});
