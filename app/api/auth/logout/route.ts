import { NextResponse } from 'next/server';
import { HAZZINO_SESSION_COOKIE, SESSION_COOKIE } from '@/lib/auth-gate';
import { cookieFromHeader } from '@/lib/auth';
import { deleteSessionByToken, findSessionByToken } from '@/lib/auth/sessions';
import { recordAuditLog } from '@/lib/auth/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const cookieHeader = req.headers.get('cookie');
  const token = cookieFromHeader(cookieHeader, HAZZINO_SESSION_COOKIE);

  if (token) {
    const active = findSessionByToken(token);
    if (active) {
      deleteSessionByToken(token);
      recordAuditLog({
        action: 'logout',
        userId: active.user.id,
        resource: 'auth',
        details: { sessionId: active.session.id },
      });
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(HAZZINO_SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
