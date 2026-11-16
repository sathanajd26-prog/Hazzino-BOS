import { requireAuth } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { computeSnapshot } from '@/lib/compute/miosa';

export const dynamic = 'force-dynamic';

/** GET /api/compute — MIOSA computers and credit balance (honest not-configured when no key). */
export async function GET() {
  const auth = requireAuth();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(await computeSnapshot({ fresh: true }), { headers: { 'Cache-Control': 'no-store' } });
}
