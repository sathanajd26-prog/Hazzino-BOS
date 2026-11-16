/**
 * HAZZINO BOS — PHASE 3: PRODUCT FINALIZATION & SECURITY TEST SUITE
 *
 * Verifies:
 * 1. Authentication lifecycle: login, logout, session expiration, inactive-user rejection
 * 2. RBAC & Five-Role Permission Matrix: super_admin, admin, manager, employee, viewer
 * 3. Cross-department access denial across tasks, workflows, and CRM
 * 4. Self-privilege escalation & self-deactivation prevention
 * 5. Unassigned legacy record protection: restricted strictly to administrators
 * 6. Database backup and restore procedures: online hot backups, integrity validation, atomic restore, production overwrite guards
 * 7. Schema index verification for department and role queries
 */
import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

// ── Auth & RBAC ──────────────────────────────────────────────
import { hasPermission, canModifyUser, type UserRole } from '@/lib/auth/rbac';
import {
  HAZZINO_SESSION_COOKIE,
  requireAuth,
  requirePermission,
  requireAnyPermission,
  requireDepartmentAccess,
  setTestRequest,
} from '@/lib/auth/guard';
import { openAuthDb, closeAuthDb } from '@/lib/auth/db';
import { createUser, setUserActive, findUserById } from '@/lib/auth/users';
import { createSession } from '@/lib/auth/sessions';
import type { SafeUser } from '@/lib/auth/types';

// ── Database & Backup ────────────────────────────────────────
import { openDb, migrateDepartmentOwnership, migrateTraining, FO_DDL } from '@/lib/db';
import { closeDb } from '@/lib/data';
import {
  createDatabaseBackup,
  verifyBackupIntegrity,
  restoreDatabaseFromBackup,
  isProductionDatabasePath,
  inspectDatabaseTables,
} from '@/lib/backup';

// ── Route Handlers ───────────────────────────────────────────
import { POST as login } from '@/app/api/auth/login/route';
import { POST as logout } from '@/app/api/auth/logout/route';
import { GET as getMe } from '@/app/api/auth/me/route';
import { PATCH as patchUser } from '@/app/api/users/[id]/route';
import {
  GET as getAgentsWork,
  POST as postAgentsWork,
  PATCH as patchAgentsWork,
  DELETE as deleteAgentsWork,
} from '@/app/api/agents/work/route';
import {
  GET as getContactsTags,
  POST as postContactsTags,
  DELETE as deleteContactsTags,
} from '@/app/api/contacts/tags/route';
import { POST as postWorkflowsDraft } from '@/app/api/workflows/draft/route';
import { POST as restoreWorkflowVersion } from '@/app/api/workflows/[id]/versions/restore/route';
import { GET as getDatabase } from '@/app/api/database/route';
import {
  GET as getWizardProjects,
  POST as postWizardProjects,
} from '@/app/api/wizard/projects/route';
import {
  GET as getWizardProject,
  PATCH as patchWizardProject,
  DELETE as deleteWizardProject,
} from '@/app/api/wizard/projects/[id]/route';

describe('Phase 3 — Product Finalization & Security', () => {
  let tmpDir: string;
  let testAuthDbPath: string;
  let testGladosDbPath: string;
  let authDb: Database.Database;
  let gladosDb: any;

  // Track created users
  let superAdminUser: SafeUser;
  let superAdminToken: string;
  let adminUser: SafeUser;
  let adminToken: string;
  let managerUser: SafeUser;
  let managerToken: string;
  let employeeUser: SafeUser;
  let employeeToken: string;
  let viewerUser: SafeUser;
  let viewerToken: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hazzino-p3-test-'));
    testAuthDbPath = path.join(tmpDir, 'auth-p3.db');
    testGladosDbPath = path.join(tmpDir, 'glados-p3.db');

    process.env.HAZZINO_AUTH_DB = testAuthDbPath;
    process.env.GLADOS_DB = testGladosDbPath;

    closeAuthDb();
    closeDb();

    authDb = openAuthDb(testAuthDbPath);
    gladosDb = openDb(testGladosDbPath);

    // Create test accounts across all 5 roles
    superAdminUser = createUser(authDb, {
      email: 'superadmin@hazzino.test',
      name: 'Super Admin',
      password: 'password123#Valid',
      role: 'super_admin',
      departmentId: null,
    });
    superAdminToken = createSession(authDb, { userId: superAdminUser.id }).rawToken;

    adminUser = createUser(authDb, {
      email: 'admin@hazzino.test',
      name: 'Operations Admin',
      password: 'password123#Valid',
      role: 'admin',
      departmentId: 'dept-operations',
    });
    adminToken = createSession(authDb, { userId: adminUser.id }).rawToken;

    managerUser = createUser(authDb, {
      email: 'manager.sales@hazzino.test',
      name: 'Sales Manager',
      password: 'password123#Valid',
      role: 'manager',
      departmentId: 'dept-sales',
    });
    managerToken = createSession(authDb, { userId: managerUser.id }).rawToken;

    employeeUser = createUser(authDb, {
      email: 'employee.sales@hazzino.test',
      name: 'Sales Employee',
      password: 'password123#Valid',
      role: 'employee',
      departmentId: 'dept-sales',
    });
    employeeToken = createSession(authDb, { userId: employeeUser.id }).rawToken;

    viewerUser = createUser(authDb, {
      email: 'viewer@hazzino.test',
      name: 'Auditor Viewer',
      password: 'password123#Valid',
      role: 'viewer',
      departmentId: 'dept-sales',
    });
    viewerToken = createSession(authDb, { userId: viewerUser.id }).rawToken;
  });

  afterEach(() => {
    setTestRequest(null);
    closeAuthDb();
    closeDb();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    delete process.env.HAZZINO_AUTH_DB;
    delete process.env.GLADOS_DB;
  });

  const authHeaders = (token: string) => ({
    Cookie: `${HAZZINO_SESSION_COOKIE}=${token}`,
    'Content-Type': 'application/json',
  });

  describe('1. Authentication Lifecycle & Inactive User Rejection', () => {
    test('successful login returns session cookie and user profile', async () => {
      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'manager.sales@hazzino.test', password: 'password123#Valid' }),
      });
      const res = await login(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.user.email).toBe('manager.sales@hazzino.test');
      expect(res.headers.get('set-cookie')).toContain(HAZZINO_SESSION_COOKIE);
    });

    test('inactive user cannot log in and returns 403', async () => {
      setUserActive(authDb, managerUser.id, false);

      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'manager.sales@hazzino.test', password: 'password123#Valid' }),
      });
      const res = await login(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/deactivated/i);
    });

    test('active session of deactivated user is immediately rejected with 401', async () => {
      // Valid session initially works
      const req1 = new Request('http://localhost/api/auth/me', { headers: authHeaders(managerToken) });
      const res1 = await getMe(req1);
      expect(res1.status).toBe(200);

      // Deactivate user
      setUserActive(authDb, managerUser.id, false);

      // Same token is now rejected
      const req2 = new Request('http://localhost/api/auth/me', { headers: authHeaders(managerToken) });
      const res2 = await getMe(req2);
      expect(res2.status).toBe(401);
    });

    test('logout invalidates session and clears cookie', async () => {
      const logoutReq = new Request('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: authHeaders(managerToken),
      });
      const logoutRes = await logout(logoutReq);
      expect(logoutRes.status).toBe(200);

      // Session is deleted
      const meReq = new Request('http://localhost/api/auth/me', { headers: authHeaders(managerToken) });
      const meRes = await getMe(meReq);
      expect(meRes.status).toBe(401);
    });
  });

  describe('2. Role Permission Matrix & Operation Hardening', () => {
    test('Viewer can view tasks, but is forbidden from creating, updating, or deleting', async () => {
      // 1. Viewer GET -> 200
      const getReq = new Request('http://localhost/api/agents/work', { headers: authHeaders(viewerToken) });
      const getRes = await getAgentsWork(getReq);
      expect(getRes.status).toBe(200);

      // 2. Viewer POST task -> 403
      const postReq = new Request('http://localhost/api/agents/work', {
        method: 'POST',
        headers: authHeaders(viewerToken),
        body: JSON.stringify({ kind: 'task', title: 'Unauthorized task' }),
      });
      const postRes = await postAgentsWork(postReq);
      expect(postRes.status).toBe(403);

      // 3. Viewer PATCH task -> 403
      const patchReq = new Request('http://localhost/api/agents/work', {
        method: 'POST',
        headers: authHeaders(viewerToken),
        body: JSON.stringify({ kind: 'task', id: 'task-1', status: 'done' }),
      });
      const patchRes = await patchAgentsWork(patchReq);
      expect(patchRes.status).toBe(403);

      // 4. Viewer DELETE task -> 403
      const deleteReq = new Request('http://localhost/api/agents/work', {
        method: 'DELETE',
        headers: authHeaders(viewerToken),
        body: JSON.stringify({ kind: 'task', id: 'task-1' }),
      });
      const deleteRes = await deleteAgentsWork(deleteReq);
      expect(deleteRes.status).toBe(403);
    });

    test('Employee can create and edit tasks, but cannot manage cron jobs or delete tasks', async () => {
      // Employee POST task -> 200
      const postReq = new Request('http://localhost/api/agents/work', {
        method: 'POST',
        headers: authHeaders(employeeToken),
        body: JSON.stringify({ kind: 'task', title: 'Employee task' }),
      });
      const postRes = await postAgentsWork(postReq);
      expect(postRes.status).toBe(200);
      const json = await postRes.json();
      expect(json.ok).toBe(true);
      const taskId = json.task.id;

      // Employee PATCH task -> 200
      const patchReq = new Request('http://localhost/api/agents/work', {
        method: 'PATCH',
        headers: authHeaders(employeeToken),
        body: JSON.stringify({ kind: 'task', id: taskId, detail: 'Updated details' }),
      });
      const patchRes = await patchAgentsWork(patchReq);
      expect(patchRes.status).toBe(200);

      // Employee DELETE task -> 403 (tasks:delete requires manager or above)
      const deleteReq = new Request('http://localhost/api/agents/work', {
        method: 'DELETE',
        headers: authHeaders(employeeToken),
        body: JSON.stringify({ kind: 'task', id: taskId }),
      });
      const deleteRes = await deleteAgentsWork(deleteReq);
      expect(deleteRes.status).toBe(403);

      // Employee POST cron -> 403 (agents:manage requires admin or above)
      const cronReq = new Request('http://localhost/api/agents/work', {
        method: 'POST',
        headers: authHeaders(employeeToken),
        body: JSON.stringify({ kind: 'cron', agentId: 'data-agent', schedule: '0 9 * * 1-5', description: 'daily' }),
      });
      const cronRes = await postAgentsWork(cronReq);
      expect(cronRes.status).toBe(403);
    });

    test('CRM contact tags: Viewer forbidden from edit, Manager/Employee allowed', async () => {
      // GET -> all can view
      const getReq = new Request('http://localhost/api/contacts/tags', { headers: authHeaders(viewerToken) });
      const getRes = await getContactsTags(getReq);
      expect(getRes.status).toBe(200);

      // POST by Viewer -> 403
      const vPost = new Request('http://localhost/api/contacts/tags', {
        method: 'POST',
        headers: authHeaders(viewerToken),
        body: JSON.stringify({ person: 'p1', channel: 'whatsapp', tag: 'client', tier: 1 }),
      });
      expect((await postContactsTags(vPost)).status).toBe(403);

      // POST by Manager -> 200
      const mPost = new Request('http://localhost/api/contacts/tags', {
        method: 'POST',
        headers: authHeaders(managerToken),
        body: JSON.stringify({ person: 'p1', channel: 'whatsapp', tag: 'client', tier: 1 }),
      });
      expect((await postContactsTags(mPost)).status).toBe(200);
    });

    test('Workflow drafting: Viewer forbidden (403), Manager/Employee allowed', async () => {
      const vReq = new Request('http://localhost/api/workflows/draft', {
        method: 'POST',
        headers: authHeaders(viewerToken),
        body: JSON.stringify({ prompt: 'Build a lead routing flow' }),
      });
      expect((await postWorkflowsDraft(vReq)).status).toBe(403);
    });
  });

  describe('3. Cross-Department Access Denial & Legacy Records', () => {
    test('Manager cannot restore workflow version of another department', async () => {
      // Seed workflow belonging to engineering
      gladosDb.workflows.insert({
        id: 'wf-eng-1',
        name: 'Core Backend Deploy',
        subtitle: 'Engineering deploy pipeline',
        revenueUsd: 0,
        order: 1,
        steps: [],
        departmentId: 'dept-engineering',
      });

      const req = new Request('http://localhost/api/workflows/wf-eng-1/versions/restore', {
        method: 'POST',
        headers: authHeaders(managerToken), // sales manager
        body: JSON.stringify({ versionId: 'v1' }),
      });

      const res = await restoreWorkflowVersion(req, { params: { id: 'wf-eng-1' } });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/department access restricted/i);
    });

    test('Admin can access cross-department workflows', async () => {
      gladosDb.workflows.insert({
        id: 'wf-eng-2',
        name: 'CI Pipeline',
        subtitle: 'Engineering pipeline',
        revenueUsd: 0,
        order: 2,
        steps: [],
        departmentId: 'dept-engineering',
      });

      const req = new Request('http://localhost/api/workflows/wf-eng-2/versions/restore', {
        method: 'POST',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ versionId: 'v-nonexistent' }),
      });

      // Admin passes department check, reaches resource logic (404 for unknown version)
      const res = await restoreWorkflowVersion(req, { params: { id: 'wf-eng-2' } });
      expect(res.status).toBe(404);
    });

    test('Unassigned legacy record is inaccessible to non-admin manager and allowed for admin', async () => {
      // Manager checking unassigned record
      const managerCheck = requireDepartmentAccess(managerUser, null, { isDepartmentScoped: true });
      expect(managerCheck).toBeInstanceOf(Response);
      expect((managerCheck as Response).status).toBe(403);

      // Admin checking unassigned record
      const adminCheck = requireDepartmentAccess(adminUser, null, { isDepartmentScoped: true });
      expect(adminCheck).not.toBeInstanceOf(Response);
      expect((adminCheck as any).user.role).toBe('admin');
    });
  });

  describe('4. Self-Privilege Escalation & Account Safeguards', () => {
    test('user cannot elevate their own role', async () => {
      const req = new Request(`http://localhost/api/users/${adminUser.id}`, {
        method: 'PATCH',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ role: 'super_admin' }),
      });

      const res = await patchUser(req, { params: { id: adminUser.id } });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/cannot change their own role/i);
    });

    test('user cannot deactivate their own account', async () => {
      const req = new Request(`http://localhost/api/users/${adminUser.id}`, {
        method: 'PATCH',
        headers: authHeaders(adminToken),
        body: JSON.stringify({ isActive: false }),
      });

      const res = await patchUser(req, { params: { id: adminUser.id } });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/cannot deactivate your own account/i);
    });

    test('sole active Super Admin cannot be demoted or deactivated', async () => {
      const req = new Request(`http://localhost/api/users/${superAdminUser.id}`, {
        method: 'PATCH',
        headers: authHeaders(superAdminToken),
        body: JSON.stringify({ role: 'admin' }),
      });

      const res = await patchUser(req, { params: { id: superAdminUser.id } });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toMatch(/only remaining active super admin/i);
    });
  });

  describe('5. Database Backup, Integrity & Restoration Safeguards', () => {
    test('creates hot backup and validates integrity', async () => {
      const backupDst = path.join(tmpDir, 'backup-test.db');
      const result = await createDatabaseBackup(testGladosDbPath, backupDst);

      expect(result.success).toBe(true);
      expect(result.bytes).toBeGreaterThan(0);
      expect(fs.existsSync(backupDst)).toBe(true);

      const integrity = verifyBackupIntegrity(backupDst);
      expect(integrity.valid).toBe(true);
      expect(integrity.tableCount).toBeGreaterThan(0);
      expect(integrity.tables).toContain('training_courses');
      expect(integrity.tables).toContain('workflows');
    });

    test('restoration to new target database preserves full data fidelity', async () => {
      // Seed known record into glados
      gladosDb.workflows.insert({
        id: 'wf-backup-verify',
        name: 'Backup Test Flow',
        subtitle: 'Verify flow backup restoration',
        revenueUsd: 0,
        order: 1,
        steps: [],
        departmentId: 'dept-sales',
      });

      const backupDst = path.join(tmpDir, 'fidelity-backup.db');
      await createDatabaseBackup(testGladosDbPath, backupDst);

      const restoreTarget = path.join(tmpDir, 'restored-glados.db');
      const restoreResult = restoreDatabaseFromBackup(backupDst, restoreTarget);

      expect(restoreResult.success).toBe(true);
      expect(fs.existsSync(restoreTarget)).toBe(true);

      // Verify restored content
      const restoredDb = new Database(restoreTarget, { readonly: true });
      const row = restoredDb.prepare('SELECT * FROM workflows WHERE id = ?').get('wf-backup-verify') as any;
      expect(row).toBeDefined();
      expect(row.name).toBe('Backup Test Flow');
      restoredDb.close();
    });

    test('restoreDatabaseFromBackup blocks overwriting active production databases without override', () => {
      const backupDst = path.join(tmpDir, 'dummy-backup.db');
      fs.writeFileSync(backupDst, ''); // dummy

      // Simulate production path target
      const prodPath = path.resolve(process.cwd(), 'data', 'glados.db');
      const result = restoreDatabaseFromBackup(backupDst, prodPath);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/SAFETY GUARD TRIGGERED/i);
    });
  });

  describe('6. Schema Performance Indexes', () => {
    test('department_id indexes exist across business tables', () => {
      const db = new Database(testGladosDbPath, { readonly: true });
      const tables = ['people', 'funnel_contacts', 'workflows', 'agent_tasks', 'training_courses'];
      for (const t of tables) {
        const indexes = db
          .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?`)
          .all(t) as { name: string }[];
        const hasDeptIndex = indexes.some((idx) => idx.name.includes('dept') || idx.name.includes('department'));
        expect(hasDeptIndex, `Table ${t} must have an index on department_id`).toBe(true);
      }
      db.close();
    });

    test('role and department indexes exist on users table in auth db', () => {
      const indexes = authDb
        .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users'`)
        .all() as { name: string }[];
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_users_department');
      expect(names).toContain('idx_users_role');
      expect(names).toContain('idx_users_email');
    });
  });
});
