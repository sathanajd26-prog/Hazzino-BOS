import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HAZZINO_SESSION_COOKIE, SESSION_COOKIE } from '@/lib/auth-gate';
import {
  checkPassword,
  clearFailures,
  clientKey,
  isConfigured as isLegacyConfigured,
  passwordShapeError,
  recordFailure,
  removePassword,
  rotateSession,
  sessionCookieOptions,
  setPassword,
  throttled,
} from '@/lib/auth';
import { getAuthenticatedUser, isAuthConfigured, hasIndividualUsers } from '@/lib/auth/guard';
import { verifyPassword } from '@/lib/auth/crypto';
import { findUserRecordById, updatePasswordHash } from '@/lib/auth/users';
import { createSession, revokeAllUserSessions } from '@/lib/auth/sessions';
import { recordAuditLog } from '@/lib/auth/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), password: z.string() }),
  z.object({ action: z.literal('change'), current: z.string(), password: z.string() }),
  z.object({ action: z.literal('rotate'), current: z.string() }),
  z.object({ action: z.literal('remove'), current: z.string() }),
]);

export async function POST(req: Request) {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'expected application/json' }, { status: 415 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const body = parsed.data;

  // 1. Check modern authenticated session
  const auth = getAuthenticatedUser(req);
  if (auth && auth.user.id !== 'legacy-operator') {
    const userRecord = findUserRecordById(auth.user.id);
    if (!userRecord) return NextResponse.json({ error: 'user not found' }, { status: 404 });

    if (body.action === 'change') {
      const valid = verifyPassword(body.current, userRecord.password_hash);
      if (!valid) return NextResponse.json({ error: 'current password is wrong' }, { status: 401 });

      const shape = passwordShapeError(body.password);
      if (shape) return NextResponse.json({ error: shape }, { status: 400 });

      // Update password hash
      updatePasswordHash(auth.user.id, body.password);

      // Invalidate ALL previous sessions belonging to this user
      revokeAllUserSessions(auth.user.id);

      // Issue fresh session for this device
      const { session, rawToken } = createSession({
        userId: auth.user.id,
        userAgent: req.headers.get('user-agent') || undefined,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      });

      recordAuditLog({
        action: 'password_change',
        userId: auth.user.id,
        resource: 'auth',
        details: { rotatedSessionId: session.id },
      });

      const res = NextResponse.json({ ok: true });
      res.cookies.set(HAZZINO_SESSION_COOKIE, rawToken, sessionCookieOptions());
      return res;
    }

    if (body.action === 'rotate') {
      const valid = verifyPassword(body.current, userRecord.password_hash);
      if (!valid) return NextResponse.json({ error: 'current password is wrong' }, { status: 401 });

      revokeAllUserSessions(auth.user.id);
      const { session, rawToken } = createSession({
        userId: auth.user.id,
        userAgent: req.headers.get('user-agent') || undefined,
        ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      });

      recordAuditLog({
        action: 'session_rotation',
        userId: auth.user.id,
        resource: 'auth',
        details: { rotatedSessionId: session.id },
      });

      const res = NextResponse.json({ ok: true });
      res.cookies.set(HAZZINO_SESSION_COOKIE, rawToken, sessionCookieOptions());
      return res;
    }
  }

  // 2. Legacy .env.local operator password flow (disabled once individual accounts exist)
  if (hasIndividualUsers()) {
    return NextResponse.json({ error: 'Legacy password management is disabled. Use employee account management.' }, { status: 403 });
  }

  const legacyConfigured = isLegacyConfigured();

  if (body.action === 'set') {
    if (isAuthConfigured()) return NextResponse.json({ error: 'a password is already set' }, { status: 409 });
    const shape = passwordShapeError(body.password);
    if (shape) return NextResponse.json({ error: shape }, { status: 400 });
    const secret = setPassword(body.password);
    const res = NextResponse.json({ ok: true, configured: true });
    res.cookies.set(SESSION_COOKIE, secret, sessionCookieOptions());
    return res;
  }

  if (!legacyConfigured) return NextResponse.json({ error: 'no password is set' }, { status: 409 });

  const key = clientKey(req);
  if (throttled(key)) return NextResponse.json({ error: 'too many attempts — wait a minute' }, { status: 429 });
  if (!checkPassword(body.current)) {
    recordFailure(key);
    return NextResponse.json({ error: 'current password is wrong' }, { status: 401 });
  }
  clearFailures(key);

  switch (body.action) {
    case 'change': {
      const shape = passwordShapeError(body.password);
      if (shape) return NextResponse.json({ error: shape }, { status: 400 });
      const secret = setPassword(body.password);
      const res = NextResponse.json({ ok: true, configured: true });
      res.cookies.set(SESSION_COOKIE, secret, sessionCookieOptions());
      return res;
    }
    case 'rotate': {
      const secret = rotateSession();
      const res = NextResponse.json({ ok: true, configured: true });
      res.cookies.set(SESSION_COOKIE, secret, sessionCookieOptions());
      return res;
    }
    case 'remove': {
      removePassword();
      const res = NextResponse.json({ ok: true, configured: false });
      res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
      res.cookies.set(HAZZINO_SESSION_COOKIE, '', { path: '/', maxAge: 0 });
      return res;
    }
  }
}
