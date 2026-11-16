import { requirePermission } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { paperclipCockpitThread, postCockpitMessage } from '@/founderos/lib/connectors/paperclip';

export const dynamic = 'force-dynamic';

/**
 * The REAL Conductor chat — the panel talks to the board's CEO (Claude Fable 5
 * with its persistent session) through the standing "Founder OS Cockpit" issue.
 * Async by nature: POST wakes the Conductor; GET polls the thread for replies.
 */
export async function GET(): Promise<NextResponse>;
export async function GET(req: Request): Promise<NextResponse>;
export async function GET(req?: Request): Promise<NextResponse> {
  const auth = requirePermission(req, 'chats:view');
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ messages: await paperclipCockpitThread(50) });
}

export async function POST(req: Request) {
  const auth = requirePermission(req, 'chats:create');
  if (auth instanceof NextResponse) return auth;
  let body: { message?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });
  try {
    const comment = await postCockpitMessage(message);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
