import { requireAuth } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { gatherCommsFeed } from '@/lib/comms-feed';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = requireAuth();
  if (auth instanceof NextResponse) return auth;
  const feed = await gatherCommsFeed();
  return NextResponse.json({ feed });
}
