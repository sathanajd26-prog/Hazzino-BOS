import { requireAuth } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { readVentures } from '@/lib/ventures-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = requireAuth();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ventures: readVentures() });
}
