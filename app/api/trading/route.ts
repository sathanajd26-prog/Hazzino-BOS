import { requireAuth } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { foMode } from '@/lib/fo-sample';
import { tradingPayload } from '@/lib/trading-payload';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The /trading payload (pages/trading.md §2). Reads SQLite and, when a wallet
 * address is set, one cached public Solana RPC read. Spends nothing.
 * `?sample=1` on a blank install, or Filming mode, answers the badged fixture
 * with no outbound request.
 */
export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  const mode = foMode(req.url, getDb().trading.isEmpty());
  return NextResponse.json(await tradingPayload(mode));
}
