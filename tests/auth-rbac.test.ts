import { beforeEach, describe, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  ROLE_HIERARCHY,
  canAccessDepartment,
  canAssignRole,
  canModifyUser,
  getRolePermissions,
  hasHigherRole,
  hasPermission,
  isRoleAtLeast,
} from '@/lib/auth/rbac';
import {
  requireDepartmentAccess,
  requirePermission,
  requireRole,
  setTestRequest,
} from '@/lib/auth/guard';
import { initAuthDb } from '@/lib/auth/db';
import { createUser, deleteUser, findUserById, listUsers, updateUser } from '@/lib/auth/users';
import { createSession } from '@/lib/auth/sessions';
import type { SafeUser, UserRole } from '@/lib/auth/types';

function mockUser(role: UserRole, departmentId: string | null = null, isActive = true): SafeUser {
  return {
    id: `user-${role}`,
    email: `${role}@hazzino.test`,
    name: `Test ${role}`,
    role,
    departmentId,
    isActive,
    failedAttempts: 0,
    lockedUntil: null,
    passwordChangedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('RBAC - Role Hierarchy', () => {
  test('strictly enforces the 5 defined roles and numeric level ordering', () => {
    expect(ROLE_HIERARCHY.super_admin).toBeGreaterThan(ROLE_HIERARCHY.admin);
    expect(ROLE_HIERARCHY.admin).toBeGreaterThan(ROLE_HIERARCHY.manager);
    expect(ROLE_HIERARCHY.manager).toBeGreaterThan(ROLE_HIERARCHY.employee);
    expect(ROLE_HIERARCHY.employee).toBeGreaterThan(ROLE_HIERARCHY.viewer);
  });

  test('isRoleAtLeast correctly compares hierarchy positions', () => {
    expect(isRoleAtLeast('super_admin', 'super_admin')).toBe(true);
    expect(isRoleAtLeast('super_admin', 'admin')).toBe(true);
    expect(isRoleAtLeast('super_admin', 'viewer')).toBe(true);

    expect(isRoleAtLeast('admin', 'super_admin')).toBe(false);
    expect(isRoleAtLeast('admin', 'admin')).toBe(true);
    expect(isRoleAtLeast('admin', 'manager')).toBe(true);

    expect(isRoleAtLeast('manager', 'admin')).toBe(false);
    expect(isRoleAtLeast('manager', 'manager')).toBe(true);
    expect(isRoleAtLeast('manager', 'employee')).toBe(true);

    expect(isRoleAtLeast('employee', 'manager')).toBe(false);
    expect(isRoleAtLeast('employee', 'employee')).toBe(true);
    expect(isRoleAtLeast('employee', 'viewer')).toBe(true);

    expect(isRoleAtLeast('viewer', 'employee')).toBe(false);
    expect(isRoleAtLeast('viewer', 'viewer')).toBe(true);
  });

  test('hasHigherRole enforces strict superiority', () => {
    expect(hasHigherRole('super_admin', 'admin')).toBe(true);
    expect(hasHigherRole('super_admin', 'super_admin')).toBe(false);
    expect(hasHigherRole('admin', 'manager')).toBe(true);
    expect(hasHigherRole('admin', 'admin')).toBe(false);
    expect(hasHigherRole('manager', 'admin')).toBe(false);
    expect(hasHigherRole('employee', 'employee')).toBe(false);
    expect(hasHigherRole('viewer', 'employee')).toBe(false);
  });
});

describe('RBAC - Permissions Engine & Deny by Default', () => {
  const superAdmin = mockUser('super_admin');
  const admin = mockUser('admin');
  const manager = mockUser('manager', 'dept-sales');
  const employee = mockUser('employee', 'dept-sales');
  const viewer = mockUser('viewer', 'dept-sales');

  test('super_admin possesses universal wildcard permissions', () => {
    expect(hasPermission(superAdmin, '*')).toBe(true);
    expect(hasPermission(superAdmin, 'system:manage')).toBe(true);
    expect(hasPermission(superAdmin, 'users:manage')).toBe(true);
    expect(hasPermission(superAdmin, 'clients:approve')).toBe(true);
    expect(getRolePermissions('super_admin')).toEqual(['*']);
  });

  test('admin has broad administrative and operational permissions but not super_admin system control', () => {
    expect(hasPermission(admin, 'users:manage')).toBe(true);
    expect(hasPermission(admin, 'modules:manage')).toBe(true);
    expect(hasPermission(admin, 'keys:manage')).toBe(true);
    expect(hasPermission(admin, 'clients:approve')).toBe(true);
    expect(hasPermission(admin, 'audit:view')).toBe(true);
    // Disallowed system root
    expect(hasPermission(admin, 'system:manage')).toBe(false);
  });

  test('manager has operational and approval permissions in their scope, no system/user manage', () => {
    expect(hasPermission(manager, 'clients:view')).toBe(true);
    expect(hasPermission(manager, 'clients:approve')).toBe(true);
    expect(hasPermission(manager, 'agents:approve')).toBe(true);
    expect(hasPermission(manager, 'tasks:approve')).toBe(true);
    expect(hasPermission(manager, 'users:view')).toBe(true);
    // Disallowed
    expect(hasPermission(manager, 'users:create')).toBe(false);
    expect(hasPermission(manager, 'modules:manage')).toBe(false);
    expect(hasPermission(manager, 'keys:manage')).toBe(false);
    expect(hasPermission(manager, 'audit:view')).toBe(false);
  });

  test('employee can create and edit within department, but cannot approve or delete sensitive resources', () => {
    expect(hasPermission(employee, 'tasks:create')).toBe(true);
    expect(hasPermission(employee, 'tasks:edit')).toBe(true);
    expect(hasPermission(employee, 'social:create')).toBe(true);
    // Disallowed
    expect(hasPermission(employee, 'tasks:approve')).toBe(false);
    expect(hasPermission(employee, 'clients:approve')).toBe(false);
    expect(hasPermission(employee, 'agents:approve')).toBe(false);
    expect(hasPermission(employee, 'tasks:delete')).toBe(false);
    expect(hasPermission(employee, 'users:view')).toBe(false);
    expect(hasPermission(employee, 'keys:manage')).toBe(false);
  });

  test('viewer has strictly read-only view permissions across allowed modules', () => {
    expect(hasPermission(viewer, 'tasks:view')).toBe(true);
    expect(hasPermission(viewer, 'clients:view')).toBe(true);
    expect(hasPermission(viewer, 'analytics:view')).toBe(true);
    expect(hasPermission(viewer, 'knowledge:view')).toBe(true);
    // Deny all mutating actions
    expect(hasPermission(viewer, 'tasks:create')).toBe(false);
    expect(hasPermission(viewer, 'tasks:edit')).toBe(false);
    expect(hasPermission(viewer, 'tasks:delete')).toBe(false);
    expect(hasPermission(viewer, 'tasks:approve')).toBe(false);
    expect(hasPermission(viewer, 'clients:approve')).toBe(false);
    expect(hasPermission(viewer, 'users:view')).toBe(false);
  });

  test('deny by default: inactive users are denied any permission', () => {
    const inactiveAdmin = mockUser('admin', null, false);
    const inactiveSuper = mockUser('super_admin', null, false);
    expect(hasPermission(inactiveAdmin, 'users:view')).toBe(false);
    expect(hasPermission(inactiveSuper, 'system:manage')).toBe(false);
    expect(hasPermission(null, 'clients:view')).toBe(false);
  });
});

describe('RBAC - Department & Resource Access Isolation', () => {
  const superAdmin = mockUser('super_admin');
  const admin = mockUser('admin');
  const salesManager = mockUser('manager', 'dept-sales');
  const salesEmployee = mockUser('employee', 'dept-sales');
  const techEmployee = mockUser('employee', 'dept-tech');
  const viewer = mockUser('viewer', 'dept-sales');

  test('super_admin and admin can access and write to any department resource', () => {
    expect(canAccessDepartment(superAdmin, 'dept-sales')).toBe(true);
    expect(canAccessDepartment(superAdmin, 'dept-tech')).toBe(true);
    expect(canAccessDepartment(admin, 'dept-sales')).toBe(true);
    expect(canAccessDepartment(admin, 'dept-tech')).toBe(true);

    expect(hasPermission(admin, 'tasks:create', { resourceDepartmentId: 'dept-sales' })).toBe(true);
    expect(hasPermission(admin, 'tasks:create', { resourceDepartmentId: 'dept-tech' })).toBe(true);
  });

  test('global resources with no department are accessible to all active roles', () => {
    expect(canAccessDepartment(salesManager, null)).toBe(true);
    expect(canAccessDepartment(salesEmployee, undefined)).toBe(true);
    expect(canAccessDepartment(viewer, '')).toBe(true);
  });

  test('manager can manage resources in their department but cannot mutate other departments', () => {
    // Within own department (dept-sales)
    expect(canAccessDepartment(salesManager, 'dept-sales')).toBe(true);
    expect(hasPermission(salesManager, 'tasks:approve', { resourceDepartmentId: 'dept-sales' })).toBe(true);
    expect(hasPermission(salesManager, 'tasks:create', { resourceDepartmentId: 'dept-sales' })).toBe(true);

    // Cross-department (dept-tech)
    expect(canAccessDepartment(salesManager, 'dept-tech')).toBe(false);
    expect(hasPermission(salesManager, 'tasks:approve', { resourceDepartmentId: 'dept-tech' })).toBe(false);
    expect(hasPermission(salesManager, 'tasks:create', { resourceDepartmentId: 'dept-tech' })).toBe(false);
  });

  test('employee can edit within their department but cannot write across departments', () => {
    expect(hasPermission(salesEmployee, 'tasks:edit', { resourceDepartmentId: 'dept-sales' })).toBe(true);
    expect(hasPermission(salesEmployee, 'tasks:edit', { resourceDepartmentId: 'dept-tech' })).toBe(false);
    expect(hasPermission(techEmployee, 'tasks:edit', { resourceDepartmentId: 'dept-tech' })).toBe(true);
    expect(hasPermission(techEmployee, 'tasks:edit', { resourceDepartmentId: 'dept-sales' })).toBe(false);
  });
});

describe('RBAC - Privilege Escalation Prevention', () => {
  const superAdmin = mockUser('super_admin');
  const admin = mockUser('admin');
  const manager = mockUser('manager');
  const employee = mockUser('employee');
  const viewer = mockUser('viewer');

  test('canAssignRole: super_admin can assign any role', () => {
    expect(canAssignRole(superAdmin, 'super_admin')).toEqual({ allowed: true });
    expect(canAssignRole(superAdmin, 'admin')).toEqual({ allowed: true });
    expect(canAssignRole(superAdmin, 'manager')).toEqual({ allowed: true });
    expect(canAssignRole(superAdmin, 'employee')).toEqual({ allowed: true });
    expect(canAssignRole(superAdmin, 'viewer')).toEqual({ allowed: true });
  });

  test('canAssignRole: admin cannot assign super_admin or admin (privilege escalation defense)', () => {
    expect(canAssignRole(admin, 'super_admin').allowed).toBe(false);
    expect(canAssignRole(admin, 'admin').allowed).toBe(false);

    expect(canAssignRole(admin, 'manager')).toEqual({ allowed: true });
    expect(canAssignRole(admin, 'employee')).toEqual({ allowed: true });
    expect(canAssignRole(admin, 'viewer')).toEqual({ allowed: true });
  });

  test('canAssignRole: manager, employee and viewer cannot assign any role', () => {
    expect(canAssignRole(manager, 'viewer').allowed).toBe(false);
    expect(canAssignRole(employee, 'viewer').allowed).toBe(false);
    expect(canAssignRole(viewer, 'viewer').allowed).toBe(false);
  });

  test('canModifyUser: admin cannot modify or delete super_admin or other admin', () => {
    const otherAdmin = mockUser('admin');
    otherAdmin.id = 'other-admin';
    const targetSuper = mockUser('super_admin');
    targetSuper.id = 'target-super';
    const targetEmployee = mockUser('employee');
    targetEmployee.id = 'target-emp';

    expect(canModifyUser(admin, targetSuper).allowed).toBe(false);
    expect(canModifyUser(admin, otherAdmin).allowed).toBe(false);
    expect(canModifyUser(admin, targetEmployee).allowed).toBe(true);
  });

  test('canModifyUser: users cannot change their own role (self-elevation defense)', () => {
    const selfAdmin = mockUser('admin');
    selfAdmin.id = 'self-admin';

    expect(canModifyUser(selfAdmin, selfAdmin, { newRole: 'super_admin' }).allowed).toBe(false);

    const selfEmployee = mockUser('employee');
    selfEmployee.id = 'self-emp';
    expect(canModifyUser(selfEmployee, selfEmployee, { newRole: 'admin' }).allowed).toBe(false);
  });

  test('canModifyUser: cannot demote or delete the last remaining active super_admin', () => {
    const actorSuper = mockUser('super_admin');
    actorSuper.id = 'actor-super';
    const targetSuper = mockUser('super_admin');
    targetSuper.id = 'target-super';

    // Demotion attempt with count = 1
    const demoteCheck = canModifyUser(actorSuper, targetSuper, { newRole: 'admin', activeSuperAdminCount: 1 });
    expect(demoteCheck.allowed).toBe(false);
    expect(demoteCheck.reason).toMatch(/only remaining active Super Admin/i);

    // Demotion allowed if another super_admin exists (activeSuperAdminCount >= 2)
    const safeDemote = canModifyUser(actorSuper, targetSuper, { newRole: 'admin', activeSuperAdminCount: 2 });
    expect(safeDemote.allowed).toBe(true);
  });
});

describe('RBAC - Server-Side Guards (requireRole, requirePermission, requireDepartmentAccess)', () => {
  beforeEach(() => {
    setTestRequest(null);
  });

  test('requireRole allows qualified roles on loopback unconfigured fallback', () => {
    const adminReq = new Request('http://localhost/test', {
      headers: { host: 'localhost:4100' },
    });

    // In unconfigured environment, request resolves to unconfigured-operator (super_admin)
    const res1 = requireRole(adminReq, 'admin');
    expect('user' in res1).toBe(true);

    const res2 = requireRole(adminReq, ['super_admin']);
    expect('user' in res2).toBe(true);
  });

  test('requirePermission allows wildcard permissions on loopback unconfigured fallback', () => {
    const req = new Request('http://localhost/test', {
      headers: { host: 'localhost:4100' },
    });
    const res = requirePermission(req, 'keys:manage');
    expect('user' in res).toBe(true);
  });

  test('requireDepartmentAccess allows access on loopback unconfigured fallback', () => {
    const req = new Request('http://localhost/test', {
      headers: { host: 'localhost:4100' },
    });
    const res = requireDepartmentAccess(req, 'dept-sales');
    expect('user' in res).toBe(true);
  });
});

describe('RBAC - In-Memory Database Multi-Role Lifecycle', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    initAuthDb(db);
  });

  test('creates users with all 5 roles and enforces role queries and updates', () => {
    const superAdmin = createUser(db, {
      email: 'sa@test.local',
      name: 'Super Admin',
      password: 'SuperPassword123!',
      role: 'super_admin',
    });
    const admin = createUser(db, {
      email: 'admin@test.local',
      name: 'Admin User',
      password: 'AdminPassword123!',
      role: 'admin',
    });
    const manager = createUser(db, {
      email: 'mgr@test.local',
      name: 'Sales Manager',
      password: 'ManagerPassword123!',
      role: 'manager',
      departmentId: 'dept-sales',
    });
    const employee = createUser(db, {
      email: 'emp@test.local',
      name: 'Sales Employee',
      password: 'EmployeePassword123!',
      role: 'employee',
      departmentId: 'dept-sales',
    });
    const viewer = createUser(db, {
      email: 'viewer@test.local',
      name: 'Guest Viewer',
      password: 'ViewerPassword123!',
      role: 'viewer',
    });

    expect(listUsers(db)).toHaveLength(5);
    expect(listUsers(db, { role: 'manager' })).toHaveLength(1);
    expect(listUsers(db, { departmentId: 'dept-sales' })).toHaveLength(2);

    // Update role
    const promoted = updateUser(db, employee.id, { role: 'manager' });
    expect(promoted?.role).toBe('manager');
    expect(listUsers(db, { role: 'manager' })).toHaveLength(2);

    // Delete viewer
    expect(deleteUser(db, viewer.id)).toBe(true);
    expect(findUserById(db, viewer.id)).toBeNull();
  });
});

describe('RBAC - Server-Side API Authorization Enforcement', () => {
  let tmpDir: string;
  let testDbPath: string;
  let tokens: Record<UserRole, string>;
  let userIds: Record<UserRole, string>;

  beforeEach(async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { closeAuthDb, openAuthDb } = await import('@/lib/auth/db');
    const { createUser } = await import('@/lib/auth/users');
    const { createSession } = await import('@/lib/auth/sessions');

    closeAuthDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hazzino-rbac-api-'));
    testDbPath = path.join(tmpDir, 'auth.db');
    process.env.HAZZINO_AUTH_DB = testDbPath;
    process.env.GLADOS_ENV_LOCAL = path.join(tmpDir, '.env.local');
    const db = openAuthDb(testDbPath);

    tokens = {} as Record<UserRole, string>;
    userIds = {} as Record<UserRole, string>;

    const roles: { role: UserRole; dept?: string }[] = [
      { role: 'super_admin' },
      { role: 'admin' },
      { role: 'manager', dept: 'dept-sales' },
      { role: 'employee', dept: 'dept-sales' },
      { role: 'viewer', dept: 'dept-sales' },
    ];

    for (const { role, dept } of roles) {
      const u = createUser(db, {
        email: `${role}@company.test`,
        name: `Named ${role}`,
        password: 'Password123!',
        role,
        departmentId: dept ?? null,
      });
      userIds[role] = u.id;
      const { rawToken } = createSession(db, { userId: u.id });
      tokens[role] = rawToken;
    }
  });

  const apiReq = (url: string, method: string, roleToken?: string, body?: unknown) =>
    new Request(`http://localhost${url}`, {
      method,
      headers: {
        host: 'localhost:4100',
        'content-type': 'application/json',
        ...(roleToken ? { cookie: `hazzino_session=${roleToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  test('POST /api/agents/deliverables/decision: manager/admin can approve; employee/viewer receive 403', async () => {
    const { POST } = await import('@/app/api/agents/deliverables/decision/route');
    const { getDb } = await import('@/lib/data');
    const now = new Date().toISOString();
    const runId = `run-rbac-${Math.random().toString(36).slice(2)}`;
    getDb().agentRuns.insert({ id: runId, agentId: 'conductor', startedAt: now, finishedAt: now, ok: true, summary: 'Done' });

    // Viewer is rejected with 403
    const viewerRes = await POST(apiReq('/api/agents/deliverables/decision', 'POST', tokens.viewer, { runId, decision: 'approved' }));
    expect(viewerRes.status).toBe(403);

    // Employee is rejected with 403
    const empRes = await POST(apiReq('/api/agents/deliverables/decision', 'POST', tokens.employee, { runId, decision: 'approved' }));
    expect(empRes.status).toBe(403);

    // Manager can approve (201)
    const mgrRes = await POST(apiReq('/api/agents/deliverables/decision', 'POST', tokens.manager, { runId, decision: 'approved' }));
    expect(mgrRes.status).toBe(201);
  });

  test('POST /api/clients/confirm: manager can confirm; employee/viewer receive 403', async () => {
    const { POST } = await import('@/app/api/clients/confirm/route');

    // Viewer is rejected with 403
    const viewerRes = await POST(apiReq('/api/clients/confirm', 'POST', tokens.viewer, { name: 'Acme Corp', source: 'manual' }));
    expect(viewerRes.status).toBe(403);

    // Employee is rejected with 403
    const empRes = await POST(apiReq('/api/clients/confirm', 'POST', tokens.employee, { name: 'Acme Corp', source: 'manual' }));
    expect(empRes.status).toBe(403);

    // Manager can confirm (201)
    const mgrRes = await POST(apiReq('/api/clients/confirm', 'POST', tokens.manager, { name: 'Acme Corp', source: 'manual' }));
    expect(mgrRes.status).toBe(201);
  });

  test('POST /api/settings/modules: admin can toggle; manager/employee/viewer receive 403', async () => {
    const { POST } = await import('@/app/api/settings/modules/route');

    // Manager rejected with 403
    const mgrRes = await POST(apiReq('/api/settings/modules', 'POST', tokens.manager, { href: '/trading', on: true }));
    expect(mgrRes.status).toBe(403);

    // Employee rejected with 403
    const empRes = await POST(apiReq('/api/settings/modules', 'POST', tokens.employee, { href: '/trading', on: true }));
    expect(empRes.status).toBe(403);

    // Admin allowed (200)
    const adminRes = await POST(apiReq('/api/settings/modules', 'POST', tokens.admin, { href: '/trading', on: true }));
    expect(adminRes.status).toBe(200);
  });

  test('POST /api/keys: admin can configure keys; manager/employee receive 403', async () => {
    const { POST } = await import('@/app/api/keys/route');

    // Manager rejected with 403
    const mgrRes = await POST(apiReq('/api/keys', 'POST', tokens.manager, { envVar: 'STRIPE_SECRET_KEY', value: 'sk_test_123' }));
    expect(mgrRes.status).toBe(403);

    // Employee rejected with 403
    const empRes = await POST(apiReq('/api/keys', 'POST', tokens.employee, { envVar: 'STRIPE_SECRET_KEY', value: 'sk_test_123' }));
    expect(empRes.status).toBe(403);

    // Admin allowed (200)
    const adminRes = await POST(apiReq('/api/keys', 'POST', tokens.admin, { envVar: 'STRIPE_SECRET_KEY', value: 'sk_test_123' }));
    expect(adminRes.status).toBe(200);
  });

  test('POST /api/cron/run: viewer/employee receive 403', async () => {
    const { POST } = await import('@/app/api/cron/run/route');

    const viewerRes = await POST(apiReq('/api/cron/run', 'POST', tokens.viewer, { cronId: 'c1' }));
    expect(viewerRes.status).toBe(403);

    const empRes = await POST(apiReq('/api/cron/run', 'POST', tokens.employee, { cronId: 'c1' }));
    expect(empRes.status).toBe(403);
  });

  test('GET /api/users: viewer/employee receive 403; manager sees department only; admin sees all', async () => {
    const { GET } = await import('@/app/api/users/route');

    // Viewer rejected
    expect((await GET(apiReq('/api/users', 'GET', tokens.viewer))).status).toBe(403);
    // Employee rejected
    expect((await GET(apiReq('/api/users', 'GET', tokens.employee))).status).toBe(403);

    // Manager sees only users in dept-sales (3 users: manager, employee, viewer)
    const mgrRes = await GET(apiReq('/api/users', 'GET', tokens.manager));
    expect(mgrRes.status).toBe(200);
    const mgrBody = await mgrRes.json();
    expect(mgrBody.users.every((u: any) => u.departmentId === 'dept-sales')).toBe(true);

    // Admin sees all 5 users
    const adminRes = await GET(apiReq('/api/users', 'GET', tokens.admin));
    expect(adminRes.status).toBe(200);
    const adminBody = await adminRes.json();
    expect(adminBody.users).toHaveLength(5);
  });

  test('POST /api/users: enforces privilege escalation prevention through API boundary', async () => {
    const { POST } = await import('@/app/api/users/route');

    // Admin attempting to create super_admin receives 403
    const escRes1 = await POST(
      apiReq('/api/users', 'POST', tokens.admin, {
        email: 'illegal-super@test.local',
        name: 'Hacked Super',
        password: 'Password123!',
        role: 'super_admin',
      }),
    );
    expect(escRes1.status).toBe(403);
    expect((await escRes1.json()).error).toMatch(/cannot create or promote to Super Admin/i);

    // Admin attempting to create admin receives 403
    const escRes2 = await POST(
      apiReq('/api/users', 'POST', tokens.admin, {
        email: 'illegal-admin@test.local',
        name: 'Hacked Admin',
        password: 'Password123!',
        role: 'admin',
      }),
    );
    expect(escRes2.status).toBe(403);
    expect((await escRes2.json()).error).toMatch(/cannot create or promote to Admin/i);

    // Manager attempting to create user receives 403
    const mgrRes = await POST(
      apiReq('/api/users', 'POST', tokens.manager, {
        email: 'new-emp@test.local',
        name: 'New Emp',
        password: 'Password123!',
        role: 'employee',
      }),
    );
    expect(mgrRes.status).toBe(403);

    // Admin can create legitimate employee (201)
    const legitRes = await POST(
      apiReq('/api/users', 'POST', tokens.admin, {
        email: 'legit-emp@test.local',
        name: 'Legit Emp',
        password: 'Password123!',
        role: 'employee',
        departmentId: 'dept-sales',
      }),
    );
    expect(legitRes.status).toBe(201);
  });

  test('PATCH and DELETE /api/users/[id]: protects higher roles and prevents last super_admin removal', async () => {
    const { PATCH, DELETE } = await import('@/app/api/users/[id]/route');

    // Admin attempting to demote super_admin receives 403
    const demoteRes = await PATCH(
      apiReq(`/api/users/${userIds.super_admin}`, 'PATCH', tokens.admin, { role: 'employee' }),
      { params: { id: userIds.super_admin } },
    );
    expect(demoteRes.status).toBe(403);

    // Admin attempting to delete super_admin receives 403
    const delSuperRes = await DELETE(
      apiReq(`/api/users/${userIds.super_admin}`, 'DELETE', tokens.admin),
      { params: { id: userIds.super_admin } },
    );
    expect(delSuperRes.status).toBe(403);

    // Super Admin attempting to delete the ONLY active super_admin receives 403
    const delSelfRes = await DELETE(
      apiReq(`/api/users/${userIds.super_admin}`, 'DELETE', tokens.super_admin),
      { params: { id: userIds.super_admin } },
    );
    expect(delSelfRes.status).toBe(403);
    expect((await delSelfRes.json()).error).toMatch(/Cannot delete the only remaining active Super Admin/i);

    // Super Admin can delete employee (200)
    const delEmpRes = await DELETE(
      apiReq(`/api/users/${userIds.employee}`, 'DELETE', tokens.super_admin),
      { params: { id: userIds.employee } },
    );
    expect(delEmpRes.status).toBe(200);
  });

  test('GET /api/auth/me: returns authenticated user profile and resolved permissions', async () => {
    const { GET } = await import('@/app/api/auth/me/route');

    const res = await GET(apiReq('/api/auth/me', 'GET', tokens.viewer));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('viewer');
    expect(body.user.email).toBe('viewer@company.test');
    expect(body.permissions).toContain('analytics:view');
    expect(body.permissions).not.toContain('users:manage');
  });

  test('POST /api/board/deliverables/decision: manager/admin can approve; employee/viewer receive 403', async () => {
    const { POST } = await import('@/app/api/board/deliverables/decision/route');

    // Viewer is rejected with 403
    const viewerRes = await POST(apiReq('/api/board/deliverables/decision', 'POST', tokens.viewer, { id: 'deliv-1', decision: 'approved' }));
    expect(viewerRes.status).toBe(403);

    // Employee is rejected with 403
    const empRes = await POST(apiReq('/api/board/deliverables/decision', 'POST', tokens.employee, { id: 'deliv-1', decision: 'approved' }));
    expect(empRes.status).toBe(403);

    // Manager passes permission check (even if validation fails or item is missing, status is not 401/403)
    const mgrRes = await POST(apiReq('/api/board/deliverables/decision', 'POST', tokens.manager, { id: 'deliv-1', decision: 'approved' }));
    expect(mgrRes.status).not.toBe(403);
    expect(mgrRes.status).not.toBe(401);
  });

  test('POST /api/brand-deals/send: manager/admin can approve; employee/viewer receive 403', async () => {
    const { POST } = await import('@/app/api/brand-deals/send/route');

    const viewerRes = await POST(apiReq('/api/brand-deals/send', 'POST', tokens.viewer, { dealId: 'r-123' }));
    expect(viewerRes.status).toBe(403);

    const empRes = await POST(apiReq('/api/brand-deals/send', 'POST', tokens.employee, { dealId: 'r-123' }));
    expect(empRes.status).toBe(403);
  });

  test('PUT /api/brand-deals/rules and POST restore: admin can manage; manager/employee/viewer receive 403', async () => {
    const { PUT } = await import('@/app/api/brand-deals/rules/route');
    const { POST: restorePOST } = await import('@/app/api/brand-deals/rules/restore/route');

    // Viewer rejected
    expect((await PUT(apiReq('/api/brand-deals/rules', 'PUT', tokens.viewer, { rules: {} }))).status).toBe(403);
    expect((await restorePOST(apiReq('/api/brand-deals/rules/restore', 'POST', tokens.viewer, { versionId: 'v1' }))).status).toBe(403);

    // Employee rejected
    expect((await PUT(apiReq('/api/brand-deals/rules', 'PUT', tokens.employee, { rules: {} }))).status).toBe(403);
    expect((await restorePOST(apiReq('/api/brand-deals/rules/restore', 'POST', tokens.employee, { versionId: 'v1' }))).status).toBe(403);

    // Manager rejected
    expect((await PUT(apiReq('/api/brand-deals/rules', 'PUT', tokens.manager, { rules: {} }))).status).toBe(403);
    expect((await restorePOST(apiReq('/api/brand-deals/rules/restore', 'POST', tokens.manager, { versionId: 'v1' }))).status).toBe(403);
  });

  test('POST /api/brand-deals/override: manager/admin can edit; employee/viewer receive 403', async () => {
    const { POST } = await import('@/app/api/brand-deals/override/route');

    expect((await POST(apiReq('/api/brand-deals/override', 'POST', tokens.viewer, { dealId: 'd1', amountUsd: 1000 }))).status).toBe(403);
    expect((await POST(apiReq('/api/brand-deals/override', 'POST', tokens.employee, { dealId: 'd1', amountUsd: 1000 }))).status).toBe(403);
  });

  test('POST /api/clients/work and launch: employee/viewer receive 403', async () => {
    const { POST: workPOST } = await import('@/app/api/clients/work/route');
    const { POST: launchPOST } = await import('@/app/api/clients/work/[id]/launch/route');

    // Work creation rejected for viewer & employee
    expect((await workPOST(apiReq('/api/clients/work', 'POST', tokens.viewer, { clientId: 'c1', brief: 'b' }))).status).toBe(403);
    expect((await workPOST(apiReq('/api/clients/work', 'POST', tokens.employee, { clientId: 'c1', brief: 'b' }))).status).toBe(403);

    // Work launch rejected for viewer & employee
    expect((await launchPOST(apiReq('/api/clients/work/w1/launch', 'POST', tokens.viewer), { params: { id: 'w1' } })).status).toBe(403);
    expect((await launchPOST(apiReq('/api/clients/work/w1/launch', 'POST', tokens.employee), { params: { id: 'w1' } })).status).toBe(403);
  });

  test('POST /api/agents/[id]/run and board run: employee/manager/admin allowed; viewer receives 403', async () => {
    const { POST: agentRunPOST } = await import('@/app/api/agents/[id]/run/route');
    const { POST: boardRunPOST } = await import('@/app/api/board/agents/[id]/run/route');

    // Viewer rejected on both run endpoints
    expect((await agentRunPOST(apiReq('/api/agents/conductor/run', 'POST', tokens.viewer), { params: { id: 'conductor' } })).status).toBe(403);
    expect((await boardRunPOST(apiReq('/api/board/agents/conductor/run', 'POST', tokens.viewer), { params: { id: 'conductor' } })).status).toBe(403);
  });

  test('PATCH /api/agents/[id]/failover: admin can manage; manager/employee/viewer receive 403', async () => {
    const { PATCH: failoverPATCH } = await import('@/app/api/agents/[id]/failover/route');

    expect((await failoverPATCH(apiReq('/api/agents/a1/failover', 'PATCH', tokens.viewer, { model: 'claude-3-5' }), { params: { id: 'a1' } })).status).toBe(403);
    expect((await failoverPATCH(apiReq('/api/agents/a1/failover', 'PATCH', tokens.employee, { model: 'claude-3-5' }), { params: { id: 'a1' } })).status).toBe(403);
    expect((await failoverPATCH(apiReq('/api/agents/a1/failover', 'PATCH', tokens.manager, { model: 'claude-3-5' }), { params: { id: 'a1' } })).status).toBe(403);
  });

  test('POST /api/creative-engine/workflows/[id]/run and stop: viewer receives 403', async () => {
    const { POST: runPOST } = await import('@/app/api/creative-engine/workflows/[id]/run/route');
    const { POST: stopPOST } = await import('@/app/api/creative-engine/workflows/[id]/stop/route');

    expect((await runPOST(apiReq('/api/creative-engine/workflows/wf1/run', 'POST', tokens.viewer), { params: { id: 'wf1' } })).status).toBe(403);
    expect((await stopPOST(apiReq('/api/creative-engine/workflows/wf1/stop', 'POST', tokens.viewer), { params: { id: 'wf1' } })).status).toBe(403);
  });

  test('POST /api/settings/filming: admin can toggle; manager/employee/viewer receive 403', async () => {
    const { POST } = await import('@/app/api/settings/filming/route');

    expect((await POST(apiReq('/api/settings/filming', 'POST', tokens.viewer, { filming: true }))).status).toBe(403);
    expect((await POST(apiReq('/api/settings/filming', 'POST', tokens.employee, { filming: true }))).status).toBe(403);
    expect((await POST(apiReq('/api/settings/filming', 'POST', tokens.manager, { filming: true }))).status).toBe(403);
  });

  test('POST /api/cron/tick: admin can execute; manager/employee/viewer receive 403', async () => {
    const { POST } = await import('@/app/api/cron/tick/route');

    expect((await POST(apiReq('/api/cron/tick', 'POST', tokens.viewer))).status).toBe(403);
    expect((await POST(apiReq('/api/cron/tick', 'POST', tokens.employee))).status).toBe(403);
    expect((await POST(apiReq('/api/cron/tick', 'POST', tokens.manager))).status).toBe(403);
  });

  test('POST /api/finances/bank-statement and statements: admin can upload; manager/employee/viewer receive 403', async () => {
    const { POST: bankPOST } = await import('@/app/api/finances/bank-statement/route');
    const { POST: stmtPOST } = await import('@/app/api/finances/statements/route');

    expect((await bankPOST(apiReq('/api/finances/bank-statement', 'POST', tokens.viewer))).status).toBe(403);
    expect((await bankPOST(apiReq('/api/finances/bank-statement', 'POST', tokens.employee))).status).toBe(403);
    expect((await bankPOST(apiReq('/api/finances/bank-statement', 'POST', tokens.manager))).status).toBe(403);

    expect((await stmtPOST(apiReq('/api/finances/statements', 'POST', tokens.viewer))).status).toBe(403);
    expect((await stmtPOST(apiReq('/api/finances/statements', 'POST', tokens.employee))).status).toBe(403);
    expect((await stmtPOST(apiReq('/api/finances/statements', 'POST', tokens.manager))).status).toBe(403);
  });

  test('deactivating an account immediately invalidates its existing sessions for subsequent API requests', async () => {
    const { GET } = await import('@/app/api/auth/me/route');
    const { PATCH } = await import('@/app/api/users/[id]/route');

    // 1. Employee session is currently valid (200)
    const validRes = await GET(apiReq('/api/auth/me', 'GET', tokens.employee));
    expect(validRes.status).toBe(200);

    // 2. Super Admin deactivates the employee account
    const deactRes = await PATCH(
      apiReq(`/api/users/${userIds.employee}`, 'PATCH', tokens.super_admin, { isActive: false }),
      { params: { id: userIds.employee } },
    );
    expect(deactRes.status).toBe(200);
    const deactBody = await deactRes.json();
    expect(deactBody.user.isActive).toBe(false);

    // 3. The employee's existing session token is IMMEDIATELY rejected (401 Unauthorized)
    const afterDeactRes = await GET(apiReq('/api/auth/me', 'GET', tokens.employee));
    expect(afterDeactRes.status).toBe(401);
    const afterBody = await afterDeactRes.json();
    expect(afterBody.error).toBe('unauthorized');
  });

  test('server-side guards (requireRole, requirePermission, requireDepartmentAccess) return 403 for unauthorized requests', async () => {
    const { requireRole, requirePermission, requireDepartmentAccess } = await import('@/lib/auth/guard');

    // Insufficient role returns 403
    const roleDenied = requireRole(apiReq('/test', 'GET', tokens.employee), 'admin');
    expect('status' in roleDenied && (roleDenied as any).status).toBe(403);

    // Insufficient permission returns 403
    const permDenied = requirePermission(apiReq('/test', 'GET', tokens.employee), 'keys:manage');
    expect('status' in permDenied && (permDenied as any).status).toBe(403);

    // Department mismatch returns 403
    const deptDenied = requireDepartmentAccess(apiReq('/test', 'GET', tokens.employee), 'dept-tech');
    expect('status' in deptDenied && (deptDenied as any).status).toBe(403);

    // Qualified role returns AuthContext
    const roleAllowed = requireRole(apiReq('/test', 'GET', tokens.employee), 'employee');
    expect('user' in roleAllowed).toBe(true);

    // Qualified permission returns AuthContext
    const permAllowed = requirePermission(apiReq('/test', 'GET', tokens.employee), 'tasks:create');
    expect('user' in permAllowed).toBe(true);

    // Qualified department returns AuthContext
    const deptAllowed = requireDepartmentAccess(apiReq('/test', 'GET', tokens.employee), 'dept-sales');
    expect('user' in deptAllowed).toBe(true);
  });
});
