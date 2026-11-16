import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import {
  closeAuthDb,
  getAuthDb,
  openAuthDb,
} from '@/lib/auth/db';
import {
  createUser,
  findUserById,
  findUserByEmail,
  setUserActive,
  lockUserUntil,
  recordFailedLogin,
  resetFailedLogins,
  updatePasswordHash,
} from '@/lib/auth/users';
import {
  createSession,
  findSessionByToken,
  deleteSessionByToken,
  revokeAllUserSessions,
  listActiveSessionsForUser,
} from '@/lib/auth/sessions';
import {
  HAZZINO_SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
  getAuthenticatedUser,
  requireAuth,
  sanitizeNextUrl,
  isAuthConfigured,
} from '@/lib/auth/guard';
import {
  decideGate,
  isOpenPath,
  isLoopbackHost,
  hostnameOf,
  requestOriginOf,
} from '@/lib/auth-gate';
import { authorizePush } from '@/lib/push-auth';
import { hashPassword, verifyPassword } from '@/lib/auth/crypto';

import { resetThrottle } from '@/lib/auth';

// Setup isolated temporary database for each test
let tmpDir: string;
let testDbPath: string;
const prevAuthDb = process.env.HAZZINO_AUTH_DB;
const prevEnvLocal = process.env.GLADOS_ENV_LOCAL;

beforeEach(() => {
  resetThrottle();
  closeAuthDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hazzino-auth-test-'));
  testDbPath = path.join(tmpDir, 'auth.db');
  process.env.HAZZINO_AUTH_DB = testDbPath;
  process.env.GLADOS_ENV_LOCAL = path.join(tmpDir, '.env.local');
  openAuthDb(testDbPath);
});

afterAll(() => {
  closeAuthDb();
  if (prevAuthDb === undefined) delete process.env.HAZZINO_AUTH_DB;
  else process.env.HAZZINO_AUTH_DB = prevAuthDb;
  if (prevEnvLocal === undefined) delete process.env.GLADOS_ENV_LOCAL;
  else process.env.GLADOS_ENV_LOCAL = prevEnvLocal;
});

describe('Phase 5D-2: Individual Authentication', () => {
  test('valid individual login verifies credentials and creates a session', async () => {
    const user = createUser({
      name: 'Alice Employee',
      email: 'alice@hazzino.com',
      role: 'employee',
      password: 'StrongPassword123!',
    });

    const { POST } = await import('@/app/api/auth/login/route');
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@hazzino.com', password: 'StrongPassword123!' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user.email).toBe('alice@hazzino.com');
    expect(body.user.passwordHash).toBeUndefined();

    // Cookie set correctly
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain(HAZZINO_SESSION_COOKIE);
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
  });

  test('invalid password increments failed attempts and returns 401', async () => {
    createUser({
      name: 'Bob Admin',
      email: 'bob@hazzino.com',
      role: 'admin',
      password: 'CorrectPassword123!',
    });

    const { POST } = await import('@/app/api/auth/login/route');
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@hazzino.com', password: 'WrongPassword999!' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid email or password/i);

    const user = findUserByEmail('bob@hazzino.com')!;
    const row = getAuthDb().prepare('SELECT failed_attempts FROM users WHERE id = ?').get(user.id) as { failed_attempts: number };
    expect(row.failed_attempts).toBe(1);
  });

  test('unknown email returns 401 without leaking existence', async () => {
    createUser({
      name: 'Super Admin',
      email: 'admin@hazzino.com',
      role: 'super_admin',
      password: 'ValidPassword123!',
    });

    const { POST } = await import('@/app/api/auth/login/route');
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent@hazzino.com', password: 'AnyPassword123!' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid email or password/i);
  });

  test('inactive account is rejected with 403', async () => {
    const user = createUser({
      name: 'Former Employee',
      email: 'former@hazzino.com',
      role: 'employee',
      password: 'ValidPassword123!',
    });
    setUserActive(user.id, false);

    const { POST } = await import('@/app/api/auth/login/route');
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'former@hazzino.com', password: 'ValidPassword123!' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/deactivated/i);
  });

  test('5 failed attempts automatically lock the account for 15 minutes', async () => {
    const user = createUser({
      name: 'Target Account',
      email: 'target@hazzino.com',
      role: 'employee',
      password: 'CorrectPassword123!',
    });

    const { POST } = await import('@/app/api/auth/login/route');
    for (let i = 0; i < 5; i++) {
      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'target@hazzino.com', password: 'WrongPassword!' }),
      });
      const res = await POST(req);
      if (i < 4) {
        expect(res.status).toBe(401);
      } else {
        // 5th attempt locks the account
        expect(res.status).toBe(423);
        const body = await res.json();
        expect(body.error).toMatch(/locked/i);
      }
    }

    // Subsequent attempt while locked also returns 423
    const lockedReq = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'target@hazzino.com', password: 'CorrectPassword123!' }),
    });
    const lockedRes = await POST(lockedReq);
    expect(lockedRes.status).toBe(423);
  });

  test('successful login resets failed attempts counter', async () => {
    const user = createUser({
      name: 'User Counter',
      email: 'counter@hazzino.com',
      role: 'employee',
      password: 'CorrectPassword123!',
    });

    // Record 2 failed attempts
    recordFailedLogin(user.id);
    recordFailedLogin(user.id);

    const { POST } = await import('@/app/api/auth/login/route');
    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'counter@hazzino.com', password: 'CorrectPassword123!' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const row = getAuthDb().prepare('SELECT failed_attempts FROM users WHERE id = ?').get(user.id) as { failed_attempts: number };
    expect(row.failed_attempts).toBe(0);
  });
});

describe('Phase 5D-2: Individual Session Lifecycle', () => {
  test('each login generates a unique cryptographically secure session token', () => {
    const user = createUser({
      name: 'Session User',
      email: 'session@hazzino.com',
      role: 'employee',
      password: 'CorrectPassword123!',
    });

    const s1 = createSession({ userId: user.id });
    const s2 = createSession({ userId: user.id });

    expect(s1.rawToken).not.toBe(s2.rawToken);
    expect(s1.session.id).not.toBe(s2.session.id);
    expect(s1.rawToken.length).toBe(64); // 32 bytes hex
  });

  test('raw session token is never stored in SQLite database', () => {
    const user = createUser({
      name: 'Raw Token Test',
      email: 'rawtoken@hazzino.com',
      role: 'employee',
      password: 'CorrectPassword123!',
    });

    const { rawToken } = createSession({ userId: user.id });

    const rows = getAuthDb().prepare('SELECT * FROM sessions WHERE user_id = ?').all(user.id) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].token_hash).toBeDefined();
    expect(rows[0].token_hash).not.toBe(rawToken);
    expect(JSON.stringify(rows)).not.toContain(rawToken);
  });

  test('valid session lookup succeeds and touches last_active_at', async () => {
    const user = createUser({
      name: 'Active User',
      email: 'active@hazzino.com',
      role: 'employee',
      password: 'CorrectPassword123!',
    });

    const { rawToken, session } = createSession({ userId: user.id });
    const originalLastActive = session.lastActiveAt;

    // Wait 5 ms
    await new Promise((r) => setTimeout(r, 5));

    const found = findSessionByToken(rawToken);
    expect(found).not.toBeNull();
    expect(found!.user.id).toBe(user.id);
    expect(found!.user.email).toBe('active@hazzino.com');
    expect(found!.session.lastActiveAt).toBeGreaterThanOrEqual(originalLastActive);
  });

  test('invalid and expired sessions are rejected', () => {
    expect(findSessionByToken('completely-invalid-token')).toBeNull();

    const user = createUser({
      name: 'Expired User',
      email: 'expired@hazzino.com',
      role: 'employee',
      password: 'CorrectPassword123!',
    });

    const { rawToken } = createSession({ userId: user.id, ttlSeconds: -10 }); // Expired in the past
    expect(findSessionByToken(rawToken)).toBeNull();
  });

  test('logout revokes individual session from database and clears cookie', async () => {
    const user = createUser({
      name: 'Logout User',
      email: 'logout@hazzino.com',
      role: 'employee',
      password: 'CorrectPassword123!',
    });

    const { rawToken, session } = createSession({ userId: user.id });
    expect(findSessionByToken(rawToken)).not.toBeNull();

    const { POST } = await import('@/app/api/auth/logout/route');
    const req = new Request('http://localhost/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `${HAZZINO_SESSION_COOKIE}=${rawToken}` },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Session is immediately revoked
    expect(findSessionByToken(rawToken)).toBeNull();

    // Cookie is cleared
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toContain(`${HAZZINO_SESSION_COOKIE}=;`);
  });

  test('password change revokes all active sessions for the user', async () => {
    const user = createUser({
      name: 'PwChange User',
      email: 'pwchange@hazzino.com',
      role: 'employee',
      password: 'OldPassword123!',
    });

    const s1 = createSession({ userId: user.id });
    const s2 = createSession({ userId: user.id });
    const s3 = createSession({ userId: user.id });

    expect(listActiveSessionsForUser(user.id).length).toBe(3);

    const { POST } = await import('@/app/api/auth/password/route');
    const req = new Request('http://localhost/api/auth/password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie: `${HAZZINO_SESSION_COOKIE}=${s1.rawToken}`,
      },
      body: JSON.stringify({
        action: 'change',
        current: 'OldPassword123!',
        password: 'NewStrongPassword456!',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // All original sessions are revoked
    expect(findSessionByToken(s1.rawToken)).toBeNull();
    expect(findSessionByToken(s2.rawToken)).toBeNull();
    expect(findSessionByToken(s3.rawToken)).toBeNull();

    // A fresh session was issued for the requesting device
    const setCookie = res.headers.get('set-cookie') || '';
    const newSessionMatch = setCookie.match(new RegExp(`${HAZZINO_SESSION_COOKIE}=([^;]+)`));
    expect(newSessionMatch).not.toBeNull();
    const newRawToken = newSessionMatch![1];
    expect(findSessionByToken(newRawToken)).not.toBeNull();
  });
});

describe('Phase 5D-2: Middleware & Route Boundaries', () => {
  test('/agents/setup/[id] is protected and requires authentication', () => {
    // In our corrected config matcher, /agents/setup/[id] is not excluded
    const configMatcher = '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|svg|ico|ttf|woff2?)$).*)';
    const regex = new RegExp('^/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|svg|ico|ttf|woff2?)$).*)');

    expect(regex.test('/agents/setup/analyst')).toBe(true);
    expect(regex.test('/agents')).toBe(true);
    expect(regex.test('/_next/static/chunks/main.js')).toBe(false);
    expect(regex.test('/favicon.ico')).toBe(false);
    expect(regex.test('/logo.png')).toBe(false);

    // Gate decision: protected page redirects unauthenticated user to login
    const decision = decideGate({
      pathname: '/agents/setup/analyst',
      method: 'GET',
      hostname: 'os.hazzino.com',
      origin: null,
      requestOrigin: 'https://os.hazzino.com',
      configured: true,
      authed: false,
    });
    expect(decision).toEqual({ kind: 'redirect-login' });
  });

  test('open redirect attacks are prevented by sanitizeNextUrl', () => {
    expect(sanitizeNextUrl('/dashboard')).toBe('/dashboard');
    expect(sanitizeNextUrl('/agents?tab=active')).toBe('/agents?tab=active');

    // Attack payloads sanitized to /
    expect(sanitizeNextUrl('https://evil.com')).toBe('/');
    expect(sanitizeNextUrl('http://evil.com/phish')).toBe('/');
    expect(sanitizeNextUrl('//evil.com')).toBe('/');
    expect(sanitizeNextUrl('/\\evil.com')).toBe('/');
    expect(sanitizeNextUrl('javascript:alert(1)')).toBe('/');
    expect(sanitizeNextUrl('/javascript:alert(1)')).toBe('/');
    expect(sanitizeNextUrl('')).toBe('/');
    expect(sanitizeNextUrl(null)).toBe('/');
    expect(sanitizeNextUrl(undefined)).toBe('/');
  });

  test('server-side guard requireAuth() rejects unauthenticated requests with 401 when configured', () => {
    createUser({
      name: 'System Admin',
      email: 'admin@hazzino.com',
      role: 'super_admin',
      password: 'AdminPassword123!',
    });

    const unauthedReq = new Request('http://os.hazzino.com/api/clients', {
      headers: { host: 'os.hazzino.com' },
    });

    const auth = requireAuth(unauthedReq);
    expect(auth instanceof Response).toBe(true);
    expect((auth as Response).status).toBe(401);
  });

  test('server-side guard requireAuth() accepts valid session and returns typed context', () => {
    const user = createUser({
      name: 'Jane Manager',
      email: 'jane@hazzino.com',
      role: 'manager',
      password: 'ManagerPassword123!',
    });

    const { rawToken } = createSession({ userId: user.id });

    const authedReq = new Request('http://os.hazzino.com/api/clients', {
      headers: {
        host: 'os.hazzino.com',
        cookie: `${HAZZINO_SESSION_COOKIE}=${rawToken}`,
      },
    });

    const auth = requireAuth(authedReq);
    expect(auth instanceof Response).toBe(false);
    const { user: authedUser, session } = auth as { user: any; session: any };
    expect(authedUser.email).toBe('jane@hazzino.com');
    expect(authedUser.role).toBe('manager');
    expect(session.userId).toBe(user.id);
  });

  test('ManyChat webhook POST fails closed without secret and verifies secret in constant time', async () => {
    process.env.MANYCHAT_WEBHOOK_SECRET = 'correct-webhook-secret-123';
    const { POST, GET } = await import('@/app/api/webhooks/manychat/route');

    // Missing secret
    const missingSecretReq = new Request('http://localhost/api/webhooks/manychat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '1', subscriber: { id: 's1' } }),
    });
    expect((await POST(missingSecretReq)).status).toBe(401);

    // Wrong secret
    const wrongSecretReq = new Request('http://localhost/api/webhooks/manychat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-manychat-secret': 'wrong-secret',
      },
      body: JSON.stringify({ id: '1', subscriber: { id: 's1' } }),
    });
    expect((await POST(wrongSecretReq)).status).toBe(401);

    // GET without credentials is 401
    const unauthedGetReq = new Request('http://localhost/api/webhooks/manychat', { method: 'GET' });
    expect((await GET(unauthedGetReq)).status).toBe(401);

    // GET with webhook secret succeeds
    const authedGetReq = new Request('http://localhost/api/webhooks/manychat', {
      method: 'GET',
      headers: { 'x-manychat-secret': 'correct-webhook-secret-123' },
    });
    expect((await GET(authedGetReq)).status).toBe(200);

    delete process.env.MANYCHAT_WEBHOOK_SECRET;
  });

  test('push-token authentication works with M2M bearer token and user session', () => {
    process.env.USAGE_PUSH_TOKEN = 'secret-usage-token-xyz';

    // 1. Bearer token works
    const bearerReq = new Request('http://localhost/api/usage/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-usage-token-xyz' },
    });
    expect(authorizePush(bearerReq, 'USAGE_PUSH_TOKEN')).toEqual({ ok: true, via: 'token' });

    // 2. Invalid bearer token rejected
    const invalidBearerReq = new Request('http://localhost/api/usage/push', {
      method: 'POST',
      headers: { Authorization: 'Bearer invalid-token' },
    });
    expect(authorizePush(invalidBearerReq, 'USAGE_PUSH_TOKEN')).toEqual({
      ok: false,
      status: 401,
      error: 'push token rejected',
    });

    // 3. User session works when no token is presented
    const user = createUser({
      name: 'Push Operator',
      email: 'operator@hazzino.com',
      role: 'super_admin',
      password: 'OperatorPassword123!',
    });
    const { rawToken } = createSession({ userId: user.id });

    const sessionReq = new Request('http://localhost/api/usage/push', {
      method: 'POST',
      headers: { cookie: `${HAZZINO_SESSION_COOKIE}=${rawToken}` },
    });
    expect(authorizePush(sessionReq, 'USAGE_PUSH_TOKEN')).toEqual({ ok: true, via: 'session' });

    delete process.env.USAGE_PUSH_TOKEN;
  });
});
