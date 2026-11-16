import { requireAuth } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { engineStatus } from '@/lib/wizard/claude';
import os from 'node:os';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const auth = requireAuth();
  if (auth instanceof NextResponse) return auth;
  const engine = await engineStatus();
  return NextResponse.json({ ok: true, engine: { ...engine, host: os.hostname() } });
}
