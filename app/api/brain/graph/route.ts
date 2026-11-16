import { requirePermission } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { readStoreNotes } from '@/lib/connectors/gbrain';
import { buildBrainGraph } from '@/lib/brain-graph';
import { BrainGraphSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse>;
export async function GET(): Promise<NextResponse>;
export async function GET(request?: Request): Promise<NextResponse> {
  const auth = requirePermission(request, 'brain:view');
  if (auth instanceof NextResponse) return auth;
  const graph = buildBrainGraph(readStoreNotes());
  return NextResponse.json(BrainGraphSchema.parse(graph));
}
