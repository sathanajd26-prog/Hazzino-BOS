import { requirePermission } from '@/lib/auth/guard';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse>;
export async function GET(): Promise<NextResponse>;
export async function GET(request?: Request): Promise<NextResponse> {
  const auth = requirePermission(request, 'org:view');
  if (auth instanceof NextResponse) return auth;
  const db = getDb();
  return NextResponse.json({ departments: db.departments.all() });
}
