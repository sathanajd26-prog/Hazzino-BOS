import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HAZZINO_SESSION_COOKIE, SESSION_COOKIE } from '@/lib/auth-gate';
import { sessionCookieOptions, isAuthConfigured, hasIndividualUsers } from '@/lib/auth/guard';
import {
  checkPassword,
  clearFailures,
  clientKey,
  readAuthState,
  recordFailure,
  throttled,
} from '@/lib/auth';
import { verifyPassword } from '@/lib/auth/crypto';
import {
  findUserRecordByEmail,
  findUserRecordById,
  recordFailedLogin,
  resetFailedLogins,
  toSafeUser,
} from '@/lib/auth/users';
import { createSession } from '@/lib/auth/sessions';
import { recordAuditLog } from '@/lib/auth/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LoginSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(1).max(512),
});

export async function POST(req: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: 'Authentication is not configured on this install.' },
      { status: 409 },
    );
  }

  const key = clientKey(req);
  if (throttled(key)) {
    return NextResponse.json({ error: 'Too many attempts — please wait a minute.' }, { status: 429 });
  }

  const parsed = LoginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid login payload.' }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = req.headers.get('user-agent') || null;

  // Case 1: Individual user login with email & password
  if (email) {
    const user = findUserRecordByEmail(email);
    if (!user) {
      recordFailure(key);
      recordAuditLog({
        action: 'login_failure',
        resource: 'auth',
        details: { email, reason: 'unknown_account' },
        ipAddress: ipAddress ?? undefined,
      });
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    if (!user.is_active) {
      recordFailure(key);
      recordAuditLog({
        action: 'login_failure',
        userId: user.id,
        resource: 'auth',
        details: { email, reason: 'inactive_account' },
        ipAddress: ipAddress ?? undefined,
      });
      return NextResponse.json({ error: 'Account is deactivated. Contact an administrator.' }, { status: 403 });
    }

    if (user.locked_until && user.locked_until > Date.now()) {
      recordFailure(key);
      recordAuditLog({
        action: 'login_failure',
        userId: user.id,
        resource: 'auth',
        details: { email, reason: 'account_locked', lockedUntil: user.locked_until },
        ipAddress: ipAddress ?? undefined,
      });
      return NextResponse.json(
        { error: 'Account is temporarily locked due to multiple failed login attempts. Try again later.' },
        { status: 423 },
      );
    }

    const valid = verifyPassword(password, user.password_hash);
    if (!valid) {
      recordFailedLogin(user.id);
      recordFailure(key);
      recordAuditLog({
        action: 'login_failure',
        userId: user.id,
        resource: 'auth',
        details: { email, reason: 'bad_password' },
        ipAddress: ipAddress ?? undefined,
      });

      const refreshed = findUserRecordById(user.id);
      if (refreshed?.locked_until && refreshed.locked_until > Date.now()) {
        return NextResponse.json(
          { error: 'Account is now temporarily locked due to multiple failed login attempts. Try again later.' },
          { status: 423 },
        );
      }
      return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    }

    // Success
    clearFailures(key);
    resetFailedLogins(user.id);

    const { session, rawToken } = createSession({
      userId: user.id,
      userAgent: userAgent ?? undefined,
      ipAddress: ipAddress ?? undefined,
    });

    recordAuditLog({
      action: 'login_success',
      userId: user.id,
      resource: 'auth',
      details: { email: user.email, role: user.role, sessionId: session.id },
      ipAddress: ipAddress ?? undefined,
    });

    const res = NextResponse.json({ ok: true, user: toSafeUser(user) });
    res.cookies.set(HAZZINO_SESSION_COOKIE, rawToken, sessionCookieOptions());
    return res;
  }

  // Case 2: Legacy single-password fallback ONLY during transition before any individual user exists
  if (!hasIndividualUsers()) {
    const state = readAuthState();
    if (state.configured && state.sessionSecret) {
      if (!checkPassword(password)) {
        recordFailure(key);
        return NextResponse.json({ error: 'Invalid password.' }, { status: 401 });
      }

      clearFailures(key);
      const res = NextResponse.json({ ok: true, legacy: true });
      res.cookies.set(SESSION_COOKIE, state.sessionSecret, sessionCookieOptions());
      return res;
    }
  }

  return NextResponse.json({ error: 'Email and password are required for individual login.' }, { status: 400 });
}
