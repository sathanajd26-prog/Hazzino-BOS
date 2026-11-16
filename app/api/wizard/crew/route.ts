import { requireAuth } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { buildCrew } from '@/lib/wizard/crew';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = requireAuth();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ ok: true, crew: buildCrew(getDb()) });
}
