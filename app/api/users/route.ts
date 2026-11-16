import { requirePermission } from '@/lib/auth/guard';
import { canAssignRole } from '@/lib/auth/rbac';
import { UserRoleSchema } from '@/lib/auth/types';
import { createUser, listUsers } from '@/lib/auth/users';
import { recordAuditLog } from '@/lib/auth/audit';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(8).max(200),
  role: UserRoleSchema,
  departmentId: z.string().trim().max(100).nullable().optional(),
});

/**
 * GET /api/users
 * Lists users.
 * - Super Admin and Admin can view all users across all departments.
 * - Managers can view users within their assigned department.
 */
export async function GET(req: Request) {
  const auth = requirePermission(req, 'users:view');
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const roleParam = url.searchParams.get('role');
  const deptParam = url.searchParams.get('departmentId');

  // Department-level scope: Managers cannot query other departments
  let departmentId: string | undefined = undefined;
  if (auth.user.role === 'manager') {
    departmentId = auth.user.departmentId || undefined;
  } else if (deptParam) {
    departmentId = deptParam;
  }

  const role = roleParam && UserRoleSchema.safeParse(roleParam).success ? UserRoleSchema.parse(roleParam) : undefined;
  const users = listUsers({ role, departmentId });

  return NextResponse.json({ users });
}

/**
 * POST /api/users
 * Creates a new user account with role assignment.
 * Strictly prevents privilege escalation (cannot assign equal or higher role than actor).
 */
export async function POST(req: Request) {
  const auth = requirePermission(req, 'users:create');
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => null);
  const parsed = CreateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid user data', issues: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  // Enforce privilege escalation defense
  const roleCheck = canAssignRole(auth.user, data.role);
  if (!roleCheck.allowed) {
    return NextResponse.json({ error: roleCheck.reason || 'forbidden: role assignment not permitted' }, { status: 403 });
  }

  try {
    const user = createUser({
      email: data.email,
      name: data.name,
      password: data.password,
      role: data.role,
      departmentId: data.departmentId ?? null,
    });

    recordAuditLog({
      action: 'user_created',
      userId: auth.user.id,
      resource: 'users',
      details: {
        createdUserId: user.id,
        email: user.email,
        role: user.role,
        departmentId: user.departmentId,
      },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('already exists')) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

