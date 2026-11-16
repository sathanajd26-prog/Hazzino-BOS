import { requirePermission } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { createGBrainProvider } from '@/lib/connectors/gbrain';
import { BrainOverviewSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse>;
export async function GET(): Promise<NextResponse>;
export async function GET(request?: Request): Promise<NextResponse> {
  const auth = requirePermission(request, 'brain:view');
  if (auth instanceof NextResponse) return auth;
  const overview = await createGBrainProvider().overview();
  return NextResponse.json(BrainOverviewSchema.parse(overview));
}
