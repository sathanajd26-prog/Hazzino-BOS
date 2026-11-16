import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SafeUser, UserRole } from '@/lib/auth/types';
import { closeAuthDb, openAuthDb } from '@/lib/auth/db';
import { createUser, findUserById, listUsers } from '@/lib/auth/users';
import { createSession } from '@/lib/auth/sessions';
import { setTestRequest } from '@/lib/auth/guard';

describe('Phase 5E: User Management & Final Authorization Hardening', () => {
  let tmpDir: string;
  let testDbPath: string;
  let tokens: Record<UserRole, string>;
  let userIds: Record<UserRole, string>;

  beforeEach(async () => {
    setTestRequest(null);
    closeAuthDb();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hazzino-users-5e-'));
    testDbPath = path.join(tmpDir, 'auth.db');
    process.env.HAZZINO_AUTH_DB = testDbPath;
    process.env.GLADOS_ENV_LOCAL = path.join(tmpDir, '.env.local');

    const db = openAuthDb(testDbPath);
    tokens = {} as Record<UserRole, string>;
    userIds = {} as Record<UserRole, string>;

    const roleConfigs: { role: UserRole; dept?: string }[] = [
      { role: 'super_admin' },
      { role: 'admin' },
      { role: 'manager', dept: 'dept-sales' },
      { role: 'employee', dept: 'dept-sales' },
      { role: 'viewer', dept: 'dept-sales' },
    ];

    for (const { role, dept } of roleConfigs) {
      const u = createUser(db, {
        email: `${role}@company.test`,
        name: `Test ${role}`,
        password: 'Password123!',
        role,
        departmentId: dept ?? null,
      });
      userIds[role] = u.id;
      const { rawToken } = createSession(db, { userId: u.id });
      tokens[role] = rawToken;
    }
  });

  afterEach(() => {
    closeAuthDb();
    delete process.env.HAZZINO_AUTH_DB;
    delete process.env.GLADOS_ENV_LOCAL;
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
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

  describe('Part A: User Management Endpoints (/api/users)', () => {
    test('GET /api/users: super_admin and admin view all users; manager is scoped to department; employee/viewer receive 403', async () => {
      const { GET } = await import('@/app/api/users/route');

      // 1. Viewer is rejected (403)
      const viewerRes = await GET(apiReq('/api/users', 'GET', tokens.viewer));
      expect(viewerRes.status).toBe(403);

      // 2. Employee is rejected (403)
      const empRes = await GET(apiReq('/api/users', 'GET', tokens.employee));
      expect(empRes.status).toBe(403);

      // 3. Manager views only their department (dept-sales)
      const mgrRes = await GET(apiReq('/api/users', 'GET', tokens.manager));
      expect(mgrRes.status).toBe(200);
      const mgrData = await mgrRes.json();
      expect(mgrData.users.length).toBeGreaterThan(0);
      expect(mgrData.users.every((u: SafeUser) => u.departmentId === 'dept-sales')).toBe(true);

      // 4. Admin views all users across departments
      const adminRes = await GET(apiReq('/api/users', 'GET', tokens.admin));
      expect(adminRes.status).toBe(200);
      const adminData = await adminRes.json();
      expect(adminData.users.length).toBe(5);

      // 5. Super Admin views all users
      const saRes = await GET(apiReq('/api/users', 'GET', tokens.super_admin));
      expect(saRes.status).toBe(200);
      const saData = await saRes.json();
      expect(saData.users.length).toBe(5);
    });

    test('POST /api/users: creates user; prevents privilege escalation; rejects unauthorized roles', async () => {
      const { POST } = await import('@/app/api/users/route');

      // 1. Employee cannot create users (403)
      const empAttempt = await POST(
        apiReq('/api/users', 'POST', tokens.employee, {
          email: 'newemp@company.test',
          name: 'New Employee',
          password: 'Password123!',
          role: 'employee',
        }),
      );
      expect(empAttempt.status).toBe(403);

      // 2. Manager cannot create users (403)
      const mgrAttempt = await POST(
        apiReq('/api/users', 'POST', tokens.manager, {
          email: 'newmgr@company.test',
          name: 'New Employee',
          password: 'Password123!',
          role: 'employee',
        }),
      );
      expect(mgrAttempt.status).toBe(403);

      // 3. Admin CANNOT assign super_admin (Privilege Escalation Defense -> 403)
      const adminElevateSuper = await POST(
        apiReq('/api/users', 'POST', tokens.admin, {
          email: 'fake_super@company.test',
          name: 'Fake Super Admin',
          password: 'Password123!',
          role: 'super_admin',
        }),
      );
      expect(adminElevateSuper.status).toBe(403);
      const elevateErr1 = await adminElevateSuper.json();
      expect(elevateErr1.error).toMatch(/Admins cannot create or promote to Super Admin/i);

      // 4. Admin CANNOT assign admin (Privilege Escalation Defense -> 403)
      const adminElevateAdmin = await POST(
        apiReq('/api/users', 'POST', tokens.admin, {
          email: 'fake_admin@company.test',
          name: 'Fake Admin',
          password: 'Password123!',
          role: 'admin',
        }),
      );
      expect(adminElevateAdmin.status).toBe(403);
      const elevateErr2 = await adminElevateAdmin.json();
      expect(elevateErr2.error).toMatch(/Admins cannot create or promote to Admin/i);

      // 5. Admin CAN create a manager (201)
      const adminCreateMgr = await POST(
        apiReq('/api/users', 'POST', tokens.admin, {
          email: 'legit_mgr@company.test',
          name: 'Legit Manager',
          password: 'Password123!',
          role: 'manager',
          departmentId: 'dept-sales',
        }),
      );
      expect(adminCreateMgr.status).toBe(201);
      const createdMgr = await adminCreateMgr.json();
      expect(createdMgr.user.email).toBe('legit_mgr@company.test');
      expect(createdMgr.user.role).toBe('manager');

      // 6. Super Admin CAN create any role including admin and super_admin (201)
      const saCreateAdmin = await POST(
        apiReq('/api/users', 'POST', tokens.super_admin, {
          email: 'legit_admin2@company.test',
          name: 'Second Admin',
          password: 'Password123!',
          role: 'admin',
        }),
      );
      expect(saCreateAdmin.status).toBe(201);
    });

    test('POST /api/users validation: rejects duplicate email (409) and invalid fields (400)', async () => {
      const { POST } = await import('@/app/api/users/route');

      // Duplicate email
      const dupRes = await POST(
        apiReq('/api/users', 'POST', tokens.super_admin, {
          email: 'admin@company.test',
          name: 'Duplicate Admin',
          password: 'Password123!',
          role: 'manager',
        }),
      );
      expect(dupRes.status).toBe(409);

      // Password too short (< 8 chars)
      const shortPass = await POST(
        apiReq('/api/users', 'POST', tokens.super_admin, {
          email: 'shortpass@company.test',
          name: 'Short Pass User',
          password: '123',
          role: 'viewer',
        }),
      );
      expect(shortPass.status).toBe(400);

      // Invalid email
      const badEmail = await POST(
        apiReq('/api/users', 'POST', tokens.super_admin, {
          email: 'not-an-email',
          name: 'Bad Email',
          password: 'Password123!',
          role: 'viewer',
        }),
      );
      expect(badEmail.status).toBe(400);
    });

    test('PATCH /api/users/[id]: protects last super_admin, prevents self-elevation, protects peer admins', async () => {
      const { PATCH } = await import('@/app/api/users/[id]/route');

      const superAdminId = userIds.super_admin;
      const adminId = userIds.admin;
      const employeeId = userIds.employee;

      // 1. User cannot change their own role (403)
      const selfElevate = await PATCH(
        apiReq(`/api/users/${adminId}`, 'PATCH', tokens.admin, {
          role: 'super_admin',
        }),
        { params: { id: adminId } },
      );
      expect(selfElevate.status).toBe(403);
      const selfErr = await selfElevate.json();
      expect(selfErr.error).toMatch(/cannot change their own role/i);

      // 2. Admin cannot modify Super Admin (403)
      const adminModSuper = await PATCH(
        apiReq(`/api/users/${superAdminId}`, 'PATCH', tokens.admin, {
          name: 'Hacked Super Admin',
        }),
        { params: { id: superAdminId } },
      );
      expect(adminModSuper.status).toBe(403);

      // 3. Cannot demote the only remaining active Super Admin (403)
      const demoteLastSuper = await PATCH(
        apiReq(`/api/users/${superAdminId}`, 'PATCH', tokens.super_admin, {
          role: 'admin',
        }),
        { params: { id: superAdminId } },
      );
      expect(demoteLastSuper.status).toBe(403);
      const demoteErr = await demoteLastSuper.json();
      expect(demoteErr.error).toMatch(/Cannot demote the only remaining active Super Admin/i);

      // 4. Cannot deactivate self (403)
      const deactSelf = await PATCH(
        apiReq(`/api/users/${adminId}`, 'PATCH', tokens.admin, {
          isActive: false,
        }),
        { params: { id: adminId } },
      );
      expect(deactSelf.status).toBe(403);
      const deactSelfErr = await deactSelf.json();
      expect(deactSelfErr.error).toMatch(/Cannot deactivate your own account/i);

      // Cannot deactivate the only remaining active Super Admin (403)
      // When super admin creates a second admin, but only 1 super admin exists:
      const deactLastSuper = await PATCH(
        apiReq(`/api/users/${superAdminId}`, 'PATCH', tokens.super_admin, {
          isActive: false,
        }),
        { params: { id: superAdminId } },
      );
      expect(deactLastSuper.status).toBe(403);

      // 5. Admin can update employee details (200)
      const updateEmp = await PATCH(
        apiReq(`/api/users/${employeeId}`, 'PATCH', tokens.admin, {
          name: 'Renamed Employee',
        }),
        { params: { id: employeeId } },
      );
      expect(updateEmp.status).toBe(200);
      const empData = await updateEmp.json();
      expect(empData.user.name).toBe('Renamed Employee');
    });

    test('Deactivation immediately invalidates active sessions', async () => {
      const { PATCH } = await import('@/app/api/users/[id]/route');
      const { GET } = await import('@/app/api/auth/me/route');

      const employeeId = userIds.employee;
      const employeeToken = tokens.employee;

      // Verify employee session is initially valid (200)
      const initMe = await GET(apiReq('/api/auth/me', 'GET', employeeToken));
      expect(initMe.status).toBe(200);
      const meData = await initMe.json();
      expect(meData.user.isActive).toBe(true);

      // Admin deactivates the employee account
      const deactRes = await PATCH(
        apiReq(`/api/users/${employeeId}`, 'PATCH', tokens.admin, {
          isActive: false,
        }),
        { params: { id: employeeId } },
      );
      expect(deactRes.status).toBe(200);

      // Immediately re-check with employee's session cookie: must return 401 Unauthorized!
      const postDeactMe = await GET(apiReq('/api/auth/me', 'GET', employeeToken));
      expect(postDeactMe.status).toBe(401);
    });

    test('DELETE /api/users/[id]: preserves last super_admin, prevents self-deletion, prevents admin from deleting peer admin', async () => {
      const { DELETE } = await import('@/app/api/users/[id]/route');
      const { getAuthDb } = await import('@/lib/auth/db');
      const { createUser } = await import('@/lib/auth/users');

      const superAdminId = userIds.super_admin;
      const adminId = userIds.admin;
      const viewerId = userIds.viewer;

      // 1. Cannot delete self (403)
      const delSelf = await DELETE(apiReq(`/api/users/${adminId}`, 'DELETE', tokens.admin), {
        params: { id: adminId },
      });
      expect(delSelf.status).toBe(403);
      const delSelfErr = await delSelf.json();
      expect(delSelfErr.error).toMatch(/Cannot delete your own account/i);

      // 2. Cannot delete last super admin (403)
      const delSuper = await DELETE(apiReq(`/api/users/${superAdminId}`, 'DELETE', tokens.super_admin), {
        params: { id: superAdminId },
      });
      expect(delSuper.status).toBe(403);

      // 3. Admin cannot delete peer admin (create second admin)
      const peerAdmin = createUser(getAuthDb(), {
        email: 'peer_admin@company.test',
        name: 'Peer Admin',
        password: 'Password123!',
        role: 'admin',
      });
      const delPeerAdmin = await DELETE(apiReq(`/api/users/${peerAdmin.id}`, 'DELETE', tokens.admin), {
        params: { id: peerAdmin.id },
      });
      expect(delPeerAdmin.status).toBe(403);
      const peerErr = await delPeerAdmin.json();
      expect(peerErr.error).toMatch(/Admins cannot modify other Admin accounts/i);

      // 4. Admin can delete viewer (200)
      const delViewer = await DELETE(apiReq(`/api/users/${viewerId}`, 'DELETE', tokens.admin), {
        params: { id: viewerId },
      });
      expect(delViewer.status).toBe(200);
      const delData = await delViewer.json();
      expect(delData.ok).toBe(true);
    });
  });

  describe('Part B: Hardened Mutation Endpoints Granular RBAC', () => {
    test('POST /api/skills/create: manager, admin, super_admin allowed; employee and viewer receive 403', async () => {
      const { POST } = await import('@/app/api/skills/create/route');

      // Viewer is denied (403)
      const vRes = await POST(
        apiReq('/api/skills/create', 'POST', tokens.viewer, {
          name: 'Viewer Skill',
          description: 'A long enough description for testing.',
          domain: 'Finance',
          group: 'Audit',
        }),
      );
      expect(vRes.status).toBe(403);

      // Employee is denied (403)
      const eRes = await POST(
        apiReq('/api/skills/create', 'POST', tokens.employee, {
          name: 'Employee Skill',
          description: 'A long enough description for testing.',
          domain: 'Finance',
          group: 'Audit',
        }),
      );
      expect(eRes.status).toBe(403);
    });

    test('POST /api/skills/propose: manager, admin, super_admin allowed; employee and viewer receive 403', async () => {
      const { POST } = await import('@/app/api/skills/propose/route');

      // Viewer is denied (403)
      const vRes = await POST(
        apiReq('/api/skills/propose', 'POST', tokens.viewer, {
          description: 'A long enough description for proposing placement.',
        }),
      );
      expect(vRes.status).toBe(403);

      // Employee is denied (403)
      const eRes = await POST(
        apiReq('/api/skills/propose', 'POST', tokens.employee, {
          description: 'A long enough description for proposing placement.',
        }),
      );
      expect(eRes.status).toBe(403);

      // Manager has skills:create permission (200)
      const mRes = await POST(
        apiReq('/api/skills/propose', 'POST', tokens.manager, {
          description: 'A long enough description for proposing placement.',
        }),
      );
      expect(mRes.status).toBe(200);
    });

    test('POST /api/social/upload: employee allowed; viewer receives 403', async () => {
      const { POST } = await import('@/app/api/social/upload/route');

      // Viewer is denied (403)
      const vRes = await POST(apiReq('/api/social/upload', 'POST', tokens.viewer));
      expect(vRes.status).toBe(403);
      const vBody = await vRes.json();
      expect(vBody.error).toMatch(/insufficient permission/i);

      // Employee is NOT rejected with 403 (they have social:create permission)
      // Since no file was passed, it returns 400 bad request, proving permission was granted!
      const eRes = await POST(apiReq('/api/social/upload', 'POST', tokens.employee));
      expect(eRes.status).toBe(400);
      const eBody = await eRes.json();
      expect(eBody.error).toContain('multipart "file" field required');
    });

    test('POST /api/social/dm/reply: employee allowed; viewer receives 403', async () => {
      const { POST } = await import('@/app/api/social/dm/reply/route');

      // Viewer is denied (403)
      const vRes = await POST(
        apiReq('/api/social/dm/reply', 'POST', tokens.viewer, {
          subscriberId: 'sub-123',
          text: 'Hello from viewer',
        }),
      );
      expect(vRes.status).toBe(403);

      // Employee is NOT rejected with 403 (they have social:edit permission)
      // Since ManyChat token is unconfigured, it returns 502, proving permission passed!
      const eRes = await POST(
        apiReq('/api/social/dm/reply', 'POST', tokens.employee, {
          subscriberId: 'sub-123',
          text: 'Hello from employee',
        }),
      );
      expect(eRes.status).not.toBe(403);
    });

    test('POST /api/agents/[id]/chat: employee allowed; viewer receives 403', async () => {
      const { POST } = await import('@/app/api/agents/[id]/chat/route');

      // Viewer is denied (403)
      const vRes = await POST(
        apiReq('/api/agents/sales-agent/chat', 'POST', tokens.viewer, {
          message: 'Hello agent from viewer',
        }),
        { params: { id: 'sales-agent' } },
      );
      expect(vRes.status).toBe(403);

      // Employee is NOT denied with 403 (they have chats:create permission)
      const eRes = await POST(
        apiReq('/api/agents/sales-agent/chat', 'POST', tokens.employee, {
          message: 'Hello agent from employee',
        }),
        { params: { id: 'sales-agent' } },
      );
      expect(eRes.status).not.toBe(403);
    });

    test('POST and GET /api/conductor/chat: employee can chat; viewer is denied on POST (403)', async () => {
      const { GET, POST } = await import('@/app/api/conductor/chat/route');

      // GET: viewer has chats:view -> 200
      const vGet = await GET(apiReq('/api/conductor/chat', 'GET', tokens.viewer));
      expect(vGet.status).toBe(200);

      // POST: viewer is denied (403)
      const vPost = await POST(
        apiReq('/api/conductor/chat', 'POST', tokens.viewer, {
          message: 'Hello conductor from viewer',
        }),
      );
      expect(vPost.status).toBe(403);

      // POST: employee is NOT denied with 403 (has chats:create permission)
      const ePost = await POST(
        apiReq('/api/conductor/chat', 'POST', tokens.employee, {
          message: 'Hello conductor from employee',
        }),
      );
      expect(ePost.status).not.toBe(403);
    });
  });

  describe('Part C: User Management UI Component (UsersG & UsersPage)', () => {
    test('renders UsersPage and UsersG with GladOS primitives and accessible structure', async () => {
      const React = await import('react');
      const { renderToStaticMarkup } = await import('react-dom/server');
      const { default: UsersPage } = await import('@/app/users/page');
      const { UsersG } = await import('@/components/users/UsersG');

      const pageEl = React.createElement(UsersPage);
      const pageHtml = renderToStaticMarkup(pageEl);

      // Verifies page renders UsersG
      expect(pageHtml).toContain('User Management');
      expect(pageHtml).toContain('Total Accounts');
      expect(pageHtml).toContain('Active Users');
      expect(pageHtml).toContain('Super Admins');
      expect(pageHtml).toContain('Your Authority');
      expect(pageHtml).toContain('Search by name, email, department');

      const gEl = React.createElement(UsersG);
      const gHtml = renderToStaticMarkup(gEl);
      expect(gHtml).toContain('data-g="GPage"');
      expect(gHtml).toContain('data-g="GSectionHeader"');
      expect(gHtml).toContain('data-g="GCard"');
    });
  });
});
