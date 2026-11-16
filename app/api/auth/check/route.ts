import { NextResponse } from 'next/server';
import { HAZZINO_SESSION_COOKIE, SESSION_COOKIE } from '@/lib/auth-gate';
import { cookieFromHeader, readAuthState, sameSecret } from '@/lib/auth';
import { findSessionByToken } from '@/lib/auth/sessions';
import { isAuthConfigured, hasIndividualUsers } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The middleware's eyes. Answers whether authentication is configured
 * and whether the presented session cookie is valid and active.
 *
 * Checks:
 * 1. hazzino_session against data/auth.db
 * 2. glados_session against legacy .env.local configuration
 */
export async function GET(req: Request) {
  const cookieHeader = req.headers.get('cookie');

  // 1. Try modern Hazzino session
  const hazzinoCookie = cookieFromHeader(cookieHeader, HAZZINO_SESSION_COOKIE);
  if (hazzinoCookie) {
    const active = findSessionByToken(hazzinoCookie);
    if (active && active.user.isActive) {
      return NextResponse.json(
        { configured: true, authed: true, user: active.user },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
  }

  // 2. Try legacy operator session fallback ONLY IF no individual users exist yet
  if (!hasIndividualUsers()) {
    const state = readAuthState();
    const legacyCookie = cookieFromHeader(cookieHeader, SESSION_COOKIE);
    const legacyAuthed = state.configured && !!legacyCookie && !!state.sessionSecret && sameSecret(legacyCookie, state.sessionSecret);

    if (legacyAuthed) {
      return NextResponse.json(
        { configured: true, authed: true },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
  }

  // 3. Not authed — report whether system is configured
  const configured = isAuthConfigured();
  return NextResponse.json(
    { configured, authed: false },
    { headers: { 'cache-control': 'no-store' } },
  );
}
