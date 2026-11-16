import { requireAuth } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { recentActivity } from '@/lib/agents/activity';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // better-sqlite3 is native — keep off the edge runtime

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const raw = Number(new URL(req.url).searchParams.get('limit'));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 200) : 50;
  return NextResponse.json({ events: recentActivity(getDb(), limit) });
}
