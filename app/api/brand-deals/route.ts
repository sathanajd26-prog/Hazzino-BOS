import { requireAuth } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { getBrandDeals } from '@/lib/brand-deals';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = requireAuth();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(await getBrandDeals());
}
