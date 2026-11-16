import { requirePermission } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { clientsBlank, clientsPayload } from '@/lib/clients-data';
import { foMode } from '@/lib/fo-sample';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The /clients payload (pages/clients.md §2): confirmed roster, work requests,
 * the Attio confirm picker (free read, cached) and whether launches are
 * allowed. Spends nothing. `?sample=1` on a blank install or Filming mode
 * answers the badged fixture with no outbound request.
 */
export async function GET(req: Request) {
  const auth = requirePermission(req, 'clients:view', { resourceDepartmentId: 'dept-clients', isDepartmentScoped: true });
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(await clientsPayload(foMode(req.url, clientsBlank())));
}
