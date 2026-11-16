import { requireAuth } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { buildLifeMap } from '@/lib/life-map';
import { LifeMapSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = requireAuth();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(LifeMapSchema.parse(buildLifeMap()));
}
