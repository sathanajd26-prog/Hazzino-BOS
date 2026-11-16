import { requireAuth } from '@/lib/auth/guard';
import { getRolePermissions } from '@/lib/auth/rbac';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's profile, role, department, and granted permissions.
 */
export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const permissions = getRolePermissions(auth.user.role);

  return NextResponse.json({
    user: auth.user,
    role: auth.user.role,
    departmentId: auth.user.departmentId,
    permissions,
  });
}

