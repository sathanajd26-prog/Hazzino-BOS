import { requireAuth } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { compileBlueprint } from '@/lib/blueprint/compile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = requireAuth();
  if (auth instanceof NextResponse) return auth;
  const graph = await compileBlueprint(getDb());
  return NextResponse.json({ ok: true, graph });
}
