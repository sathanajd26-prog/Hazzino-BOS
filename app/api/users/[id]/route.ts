import { requireAuth, requirePermission } from '@/lib/auth/guard';
import { canModifyUser, hasPermission } from '@/lib/auth/rbac';
import { UserRoleSchema } from '@/lib/auth/types';
import { deleteUser, findUserById, listUsers, setUserActive, updateUser } from '@/lib/auth/users';
import { recordAuditLog } from '@/lib/auth/audit';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  role: UserRoleSchema.optional(),
  departmentId: z.string().trim().max(100).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * GET /api/users/[id]
 * Retrieves details for a specific user.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const target = findUserById(params.id);
  if (!target) return NextResponse.json({ error: 'user not found' }, { status: 404 });

  const isSelf = auth.user.id === target.id;
  const canView = hasPermission(auth.user, 'users:view');

  if (!isSelf && !canView) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Manager department scope
  if (!isSelf && auth.user.role === 'manager') {
    if (target.departmentId !== auth.user.departmentId) {
      return NextResponse.json({ error: 'forbidden: cross-department access not permitted' }, { status: 403 });
    }
  }

  return NextResponse.json({ user: target });
}

/**
 * PATCH /api/users/[id]
 * Updates user profile, role, department, or active status.
 * Enforces privilege escalation guards and role protection rules.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(req, 'users:edit');
  if (auth instanceof NextResponse) return auth;

  const target = findUserById(params.id);
  if (!target) return NextResponse.json({ error: 'user not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid update data', issues: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const activeSuperAdminCount = listUsers({ role: 'super_admin', isActive: true }).length;

  const modifyCheck = canModifyUser(auth.user, target, {
    newRole: data.role,
    activeSuperAdminCount,
  });

  if (!modifyCheck.allowed) {
    return NextResponse.json({ error: modifyCheck.reason || 'forbidden' }, { status: 403 });
  }

  let updated = target;
  if (data.name !== undefined || data.role !== undefined || data.departmentId !== undefined) {
    const res = updateUser(target.id, {
      name: data.name,
      role: data.role,
      departmentId: data.departmentId,
    });
    if (res) updated = res;
  }

  if (data.isActive !== undefined && data.isActive !== target.isActive) {
    if (target.role === 'super_admin' && !data.isActive && activeSuperAdminCount <= 1) {
      return NextResponse.json({ error: 'Cannot deactivate the only remaining active Super Admin' }, { status: 403 });
    }
    if (auth.user.id === target.id && !data.isActive) {
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 403 });
    }
    const res = setUserActive(target.id, data.isActive);
    if (res) updated = res;
  }

  recordAuditLog({
    action: 'user_updated',
    userId: auth.user.id,
    resource: 'users',
    details: {
      targetUserId: target.id,
      changes: data,
    },
  });

  return NextResponse.json({ user: updated });
}

/**
 * DELETE /api/users/[id]
 * Deletes a user account.
 * Enforces role protection rules and preserves the last active Super Admin.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = requirePermission(req, 'users:delete');
  if (auth instanceof NextResponse) return auth;

  const target = findUserById(params.id);
  if (!target) return NextResponse.json({ error: 'user not found' }, { status: 404 });

  const activeSuperAdminCount = listUsers({ role: 'super_admin', isActive: true }).length;

  if (target.role === 'super_admin' && activeSuperAdminCount <= 1) {
    return NextResponse.json({ error: 'Cannot delete the only remaining active Super Admin' }, { status: 403 });
  }

  const isSelf = auth.user.id === target.id;
  if (isSelf) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 403 });
  }

  const modifyCheck = canModifyUser(auth.user, target, { activeSuperAdminCount });
  if (!modifyCheck.allowed) {
    return NextResponse.json({ error: modifyCheck.reason || 'forbidden' }, { status: 403 });
  }

  deleteUser(target.id);

  recordAuditLog({
    action: 'user_deleted',
    userId: auth.user.id,
    resource: 'users',
    details: {
      deletedUserId: target.id,
      email: target.email,
      role: target.role,
    },
  });

  return NextResponse.json({ ok: true, deletedId: target.id });
}

