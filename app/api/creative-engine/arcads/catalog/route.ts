import { requireAuth } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { readCatalog } from '@/lib/arcads/catalog';
import { setupHrefFor } from '@/lib/integrations-catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Actors (grouped from situations), voices, products — cached 10 min. Honest state when unkeyed. */
export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const force = new URL(request.url).searchParams.get('refresh') === '1';
  const catalog = await readCatalog(force);
  return NextResponse.json({ ok: true, ...catalog, setupHref: setupHrefFor('arcads') });
}
