import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { parseManyChatWebhook } from '@/lib/connectors/manychat-webhook';
import { sameSecret } from '@/lib/auth';
import { getAuthenticatedUser } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * ManyChat "External Request" ingest. ManyChat's API can't be polled for DMs,
 * so this push endpoint is how the /social Instagram DM inbox goes live: point a
 * ManyChat automation's External Request (POST) at this URL with a JSON body
 * carrying the contact + message. Each message upserts by id, so replays don't
 * duplicate.
 *
 * This route is the ONE endpoint the auth middleware lets through (ManyChat
 * cannot hold a session cookie), so it carries its own shared secret and
 * FAILS CLOSED: with MANYCHAT_WEBHOOK_SECRET unset it refuses every request
 * rather than accepting anonymous writes. Verification uses constant-time comparison.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.MANYCHAT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'webhook disabled: MANYCHAT_WEBHOOK_SECRET is not set on this host' },
      { status: 503 },
    );
  }
  const presented = request.headers.get('x-manychat-secret') || '';
  if (!sameSecret(presented, secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const raw = await request.json().catch(() => null);
  const message = parseManyChatWebhook(raw);
  if (!message) {
    return NextResponse.json({ error: 'payload missing a subscriber id' }, { status: 400 });
  }

  getDb().social.upsertDmMessage(message);
  return NextResponse.json({ ok: true, id: message.id, subscriberId: message.subscriberId });
}

/**
 * Health & status check: only visible to callers presenting the webhook secret
 * or an authenticated operator session. Unauthenticated calls are rejected with 401.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.MANYCHAT_WEBHOOK_SECRET;
  const presented = request.headers.get('x-manychat-secret') || '';
  const isSecretValid = Boolean(secret && sameSecret(presented, secret));
  const isAuthedSession = Boolean(getAuthenticatedUser(request));

  if (!isSecretValid && !isAuthedSession) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    endpoint: 'manychat-webhook',
    secured: Boolean(secret),
    stored: getDb().social.dmMessages('instagram').length,
  });
}
