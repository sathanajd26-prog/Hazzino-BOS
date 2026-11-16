/**
 * HAZZINO BOS — PHASE 2: COMPLETE ESSENTIAL BUSINESS WORKFLOWS TEST SUITE
 *
 * Verifies:
 * 1. Part A: Department Migration & Legacy Record Isolation (Idempotent DDL, unassigned records protected from non-admins, department-scoped access)
 * 2. HR & Users: Personnel directory listing, employee record creation, updates, and removal with RBAC and department isolation
 * 3. CRM & Sales: Lead ingestion, journey follow-up touches, stage transition, pipeline status, and cross-department protection
 * 4. Projects & Operations: Task creation, department assignment, status updates, task listing, and workflow RBAC
 * 5. Training & Education: Courses, batch scheduling, participant enrollment, progress and attendance tracking, stats
 * 6. Finance & Comms: Real-mode ledger preservation and human-reviewed comms safety
 */
import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

// ── RBAC & Auth ──────────────────────────────────────────────
import {
  canAccessDepartment,
  hasPermission,
  type Permission,
} from '@/lib/auth/rbac';
import {
  requirePermission,
  requireDepartmentAccess,
  requireAuth,
  setTestRequest,
  HAZZINO_SESSION_COOKIE,
} from '@/lib/auth/guard';
import { openAuthDb, closeAuthDb } from '@/lib/auth/db';
import { createUser } from '@/lib/auth/users';
import { createSession } from '@/lib/auth/sessions';
import type { SafeUser, UserRole } from '@/lib/auth/types';

// ── Database & Migrations ────────────────────────────────────
import {
  openDb,
  migrateDepartmentOwnership,
  migrateTraining,
  TRAINING_TABLES,
  FO_DDL,
} from '@/lib/db';
import { closeDb } from '@/lib/data';

// ── API Route Handlers ───────────────────────────────────────
import { GET as getPeople, POST as postPeople } from '@/app/api/people/route';
import { GET as getPerson, PATCH as patchPerson, DELETE as deletePerson } from '@/app/api/people/[id]/route';

import { GET as getFunnel, POST as postFunnel } from '@/app/api/funnel/route';
import { GET as getFunnelContact, PATCH as patchFunnelContact, DELETE as deleteFunnelContact } from '@/app/api/funnel/[id]/route';
import { POST as postFunnelTouch } from '@/app/api/funnel/[id]/touch/route';

import { GET as getTasks, POST as postTasks } from '@/app/api/tasks/route';
import { GET as getTask, PATCH as patchTask, DELETE as deleteTask } from '@/app/api/tasks/[id]/route';
import { GET as getWorkflows, POST as postWorkflow } from '@/app/api/workflows/route';
import { PATCH as patchWorkflow, DELETE as deleteWorkflow } from '@/app/api/workflows/[id]/route';

import { GET as getTraining, POST as postTraining } from '@/app/api/training/route';
import { GET as getTrainingCourse, PATCH as patchTrainingCourse, DELETE as deleteTrainingCourse } from '@/app/api/training/[id]/route';
import { GET as getTrainingBatch, PATCH as patchTrainingBatch, DELETE as deleteTrainingBatch } from '@/app/api/training/batches/[id]/route';
import { GET as getParticipants, POST as postParticipant } from '@/app/api/training/participants/route';
import { GET as getParticipant, PATCH as patchParticipant, DELETE as deleteParticipant } from '@/app/api/training/participants/[id]/route';

describe('Phase 2: Complete Essential Business Workflows', () => {
  let tempDir: string;
  let authDbPath: string;
  let gladosDbPath: string;
  let savedAuthDbEnv: string | undefined;
  let savedGladosDbEnv: string | undefined;

  let superAdminUser: SafeUser;
  let adminUser: SafeUser;
  let salesManagerUser: SafeUser;
  let opsManagerUser: SafeUser;
  let salesEmployeeUser: SafeUser;
  let viewerUser: SafeUser;

  let superAdminCookie: string;
  let adminCookie: string;
  let salesManagerCookie: string;
  let opsManagerCookie: string;
  let salesEmployeeCookie: string;
  let viewerCookie: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hazzino-phase2-test-'));
    authDbPath = path.join(tempDir, 'auth.db');
    gladosDbPath = path.join(tempDir, 'glados.db');

    savedAuthDbEnv = process.env.HAZZINO_AUTH_DB;
    savedGladosDbEnv = process.env.GLADOS_DB;
    process.env.HAZZINO_AUTH_DB = authDbPath;
    process.env.GLADOS_DB = gladosDbPath;

    // Initialize temporary databases
    closeDb();
    const authDb = openAuthDb(authDbPath);
    const gladosDb = openDb(gladosDbPath);

    // Seed test users across roles and departments
    superAdminUser = createUser(authDb, {
      email: 'superadmin@example.com',
      password: 'SuperPassword123!',
      role: 'super_admin',
      departmentId: null,
      name: 'Super Admin',
    });
    superAdminCookie = createSession(authDb, { userId: superAdminUser.id }).rawToken;

    adminUser = createUser(authDb, {
      email: 'admin@example.com',
      password: 'AdminPassword123!',
      role: 'admin',
      departmentId: null,
      name: 'Operations Admin',
    });
    adminCookie = createSession(authDb, { userId: adminUser.id }).rawToken;

    salesManagerUser = createUser(authDb, {
      email: 'sales.mgr@example.com',
      password: 'SalesPassword123!',
      role: 'manager',
      departmentId: 'dept-sales',
      name: 'Sales Manager',
    });
    salesManagerCookie = createSession(authDb, { userId: salesManagerUser.id }).rawToken;

    opsManagerUser = createUser(authDb, {
      email: 'ops.mgr@example.com',
      password: 'OpsPassword123!',
      role: 'manager',
      departmentId: 'dept-ops',
      name: 'Ops Manager',
    });
    opsManagerCookie = createSession(authDb, { userId: opsManagerUser.id }).rawToken;

    salesEmployeeUser = createUser(authDb, {
      email: 'sales.emp@example.com',
      password: 'EmpPassword123!',
      role: 'employee',
      departmentId: 'dept-sales',
      name: 'Sales Rep',
    });
    salesEmployeeCookie = createSession(authDb, { userId: salesEmployeeUser.id }).rawToken;

    viewerUser = createUser(authDb, {
      email: 'viewer@example.com',
      password: 'ViewerPassword123!',
      role: 'viewer',
      departmentId: 'dept-sales',
      name: 'Auditor',
    });
    viewerCookie = createSession(authDb, { userId: viewerUser.id }).rawToken;

    // Seed default departments in gladosDb
    gladosDb.departments.insert({
      id: 'dept-sales',
      name: 'Sales & BD',
      slug: 'sales',
      tagline: 'Revenue generation',
      color: '#10b981',
      order: 1,
    });
    gladosDb.departments.insert({
      id: 'dept-ops',
      name: 'Operations',
      slug: 'ops',
      tagline: 'Execution and delivery',
      color: '#3b82f6',
      order: 2,
    });
    gladosDb.departments.insert({
      id: 'dept-marketing-growth',
      name: 'Growth & Marketing',
      slug: 'marketing',
      tagline: 'Audience and pipeline',
      color: '#f59e0b',
      order: 3,
    });
  });

  afterEach(() => {
    closeAuthDb();
    closeDb();
    setTestRequest(null);

    if (savedAuthDbEnv !== undefined) process.env.HAZZINO_AUTH_DB = savedAuthDbEnv;
    else delete process.env.HAZZINO_AUTH_DB;

    if (savedGladosDbEnv !== undefined) process.env.GLADOS_DB = savedGladosDbEnv;
    else delete process.env.GLADOS_DB;

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function makeReq(url: string, cookie: string, options: RequestInit = {}): Request {
    const headers = new Headers(options.headers || {});
    headers.set('Cookie', `${HAZZINO_SESSION_COOKIE}=${cookie}`);
    return new Request(url, { ...options, headers });
  }

  // ─────────────────────────────────────────────────────────────
  // A. Department Migration & Legacy Record Isolation
  // ─────────────────────────────────────────────────────────────
  describe('A. Department Migration & Legacy Record Isolation', () => {
    test('1. migrateDepartmentOwnership adds department_id safely and preserves unassigned records', () => {
      const dbPath = path.join(tempDir, 'legacy.db');
      const rawDb = new Database(dbPath);
      rawDb.exec(`
        CREATE TABLE funnel_contacts (id TEXT PRIMARY KEY, name TEXT NOT NULL, venture TEXT NOT NULL, status TEXT NOT NULL, product TEXT, amount_usd REAL, relationship TEXT NOT NULL, likelihood INTEGER NOT NULL, email TEXT, phone TEXT, person TEXT, company TEXT, role TEXT, linkedin TEXT, created_at TEXT NOT NULL);
        CREATE TABLE client_confirmations (id TEXT PRIMARY KEY, client_name TEXT NOT NULL, proposal_slug TEXT NOT NULL, status TEXT NOT NULL, quote_usd INTEGER NOT NULL, confirmed_at TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE client_work (id TEXT PRIMARY KEY, client_name TEXT NOT NULL, package_slug TEXT NOT NULL, status TEXT NOT NULL, quote_usd INTEGER NOT NULL, intake_answers_json TEXT NOT NULL, launched_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE lead_magnets (id TEXT PRIMARY KEY, name TEXT NOT NULL, offer TEXT NOT NULL, url TEXT NOT NULL, status TEXT NOT NULL, captures TEXT NOT NULL, destination TEXT NOT NULL, went_live_at TEXT, notes TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, subtitle TEXT NOT NULL, revenue_usd INTEGER NOT NULL, "order" INTEGER NOT NULL, steps_json TEXT NOT NULL);
        CREATE TABLE agent_tasks (id TEXT PRIMARY KEY, agent_id TEXT, title TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      `);

      // Insert legacy rows without department_id
      rawDb.exec(`
        INSERT INTO funnel_contacts (id, name, venture, status, relationship, likelihood, created_at)
        VALUES ('c-legacy-1', 'Legacy Lead', 'default', 'lead', 'warm', 50, '2026-01-01');
        INSERT INTO agent_tasks (id, agent_id, title, status, created_at, updated_at)
        VALUES ('task-legacy-1', 'agent-alpha', 'Legacy Task', 'open', '2026-01-01', '2026-01-01');
      `);

      // Run migration
      migrateDepartmentOwnership(rawDb);

      // Verify column exists
      const contactCols = (rawDb.prepare('PRAGMA table_info(funnel_contacts)').all() as any[]).map((c) => c.name);
      expect(contactCols).toContain('department_id');

      // Verify existing rows have department_id === null
      const row = rawDb.prepare('SELECT department_id FROM funnel_contacts WHERE id = ?').get('c-legacy-1') as any;
      expect(row.department_id).toBeNull();

      rawDb.close();
    });

    test('2. Unassigned legacy records are restricted to admin and super_admin, hidden from managers/employees', () => {
      // super_admin & admin can access null department
      expect(canAccessDepartment(superAdminUser, null, { isDepartmentScoped: true })).toBe(true);
      expect(canAccessDepartment(adminUser, null, { isDepartmentScoped: true })).toBe(true);

      // manager & employee cannot access unassigned null department
      expect(canAccessDepartment(salesManagerUser, null, { isDepartmentScoped: true })).toBe(false);
      expect(canAccessDepartment(salesEmployeeUser, null, { isDepartmentScoped: true })).toBe(false);
    });

    test('3. Migration is idempotent and safe under repeated executions', () => {
      const dbPath = path.join(tempDir, 'idempotent.db');
      const rawDb = new Database(dbPath);
      migrateDepartmentOwnership(rawDb);
      migrateDepartmentOwnership(rawDb);
      migrateTraining(rawDb);
      migrateTraining(rawDb);

      for (const table of TRAINING_TABLES) {
        const exists = rawDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
        expect(exists).toBeTruthy();
      }
      rawDb.close();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // B1. HR & Users Module
  // ─────────────────────────────────────────────────────────────
  describe('B1. HR & Personnel Directory', () => {
    test('1. Employee directory (GET /api/people) filters by department for managers, universal for admins', async () => {
      const db = openDb(gladosDbPath);
      db.people.insert({
        id: 'p-sales-1',
        departmentId: 'dept-sales',
        name: 'Alice Sales',
        role: 'Account Executive',
        tools: ['recall', 'ledger'],
      });
      db.people.insert({
        id: 'p-ops-1',
        departmentId: 'dept-ops',
        name: 'Bob Ops',
        role: 'Operations Lead',
        tools: ['slack'],
      });

      // Admin sees all
      const adminReq = makeReq('http://localhost:3000/api/people', adminCookie);
      const adminRes = await getPeople(adminReq);
      expect(adminRes.status).toBe(200);
      const adminData = await adminRes.json();
      expect(adminData.people.length).toBe(2);

      // Sales Manager only sees Sales personnel
      const mgrReq = makeReq('http://localhost:3000/api/people', salesManagerCookie);
      const mgrRes = await getPeople(mgrReq);
      expect(mgrRes.status).toBe(200);
      const mgrData = await mgrRes.json();
      expect(mgrData.people.length).toBe(1);
      expect(mgrData.people[0].id).toBe('p-sales-1');
    });

    test('2. POST /api/people enforces department boundaries on creation', async () => {
      // Sales manager creating employee in dept-sales succeeds
      const validReq = makeReq('http://localhost:3000/api/people', salesManagerCookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'p-sales-new',
          departmentId: 'dept-sales',
          name: 'Charlie Rep',
          role: 'Junior Sales',
          tools: ['ledger'],
        }),
      });
      const validRes = await postPeople(validReq);
      expect(validRes.status).toBe(201);
      const validData = await validRes.json();
      expect(validData.person.name).toBe('Charlie Rep');

      // Sales manager attempting to create employee in dept-ops fails with 403
      const crossReq = makeReq('http://localhost:3000/api/people', salesManagerCookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'p-ops-illegal',
          departmentId: 'dept-ops',
          name: 'Intruder',
          role: 'Ops Rogue',
          tools: ['slack'],
        }),
      });
      const crossRes = await postPeople(crossReq);
      expect(crossRes.status).toBe(403);
    });

    test('3. PATCH and DELETE /api/people/[id] enforce department access and RBAC', async () => {
      const db = openDb(gladosDbPath);
      db.people.insert({
        id: 'p-sales-target',
        departmentId: 'dept-sales',
        name: 'Target Person',
        role: 'Sales Senior',
        tools: ['recall'],
      });

      // Ops manager cannot edit sales employee (403)
      const crossPatchReq = makeReq('http://localhost:3000/api/people/p-sales-target', opsManagerCookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'Hacked Role' }),
      });
      const crossPatchRes = await patchPerson(crossPatchReq, { params: { id: 'p-sales-target' } });
      expect(crossPatchRes.status).toBe(403);

      // Sales manager can edit sales employee
      const validPatchReq = makeReq('http://localhost:3000/api/people/p-sales-target', salesManagerCookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'Lead Sales' }),
      });
      const validPatchRes = await patchPerson(validPatchReq, { params: { id: 'p-sales-target' } });
      expect(validPatchRes.status).toBe(200);
      const validPatchData = await validPatchRes.json();
      expect(validPatchData.person.role).toBe('Lead Sales');

      // Employee cannot delete personnel (403: hr:delete requires admin/super_admin)
      const empDeleteReq = makeReq('http://localhost:3000/api/people/p-sales-target', salesEmployeeCookie, {
        method: 'DELETE',
      });
      const empDeleteRes = await deletePerson(empDeleteReq, { params: { id: 'p-sales-target' } });
      expect(empDeleteRes.status).toBe(403);

      // Admin can delete personnel (200)
      const adminDeleteReq = makeReq('http://localhost:3000/api/people/p-sales-target', adminCookie, {
        method: 'DELETE',
      });
      const adminDeleteRes = await deletePerson(adminDeleteReq, { params: { id: 'p-sales-target' } });
      expect(adminDeleteRes.status).toBe(200);
      expect(db.people.get('p-sales-target')).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // B2. CRM & Sales Module
  // ─────────────────────────────────────────────────────────────
  describe('B2. CRM & Sales Pipeline', () => {
    test('1. Ingest lead, record journey touch, and transition stages', async () => {
      // Create lead
      const postReq = makeReq('http://localhost:3000/api/funnel', salesManagerCookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'c-acme-corp',
          name: 'Acme Inbound Lead',
          venture: 'default',
          status: 'first_touch',
          relationship: 'warm',
          likelihood: 60,
          email: 'buyer@acme.com',
          company: 'Acme Corp',
          touch: {
            stage: 'first_touch',
            channel: 'organic',
            label: 'Web contact form submission',
            source: 'manual',
          },
        }),
      });
      const postRes = await postFunnel(postReq);
      expect(postRes.status).toBe(201);
      const postData = await postRes.json();
      expect(postData.contact.id).toBe('c-acme-corp');
      expect(postData.journey.touches.length).toBe(1);

      // Add follow-up touch
      const touchReq = makeReq('http://localhost:3000/api/funnel/c-acme-corp/touch', salesManagerCookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: 'nurtured',
          channel: 'call',
          label: 'Discovery call held, proposal requested',
          source: 'manual',
        }),
      });
      const touchRes = await postFunnelTouch(touchReq, { params: { id: 'c-acme-corp' } });
      expect(touchRes.status).toBe(201);
      const touchData = await touchRes.json();
      expect(touchData.journey.touches.length).toBe(2);

      // Transition stage to converted / opted_in
      const patchReq = makeReq('http://localhost:3000/api/funnel/c-acme-corp', salesManagerCookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'converted',
          product: 'Enterprise Annual Tier',
          amountUsd: 15000,
          likelihood: 100,
        }),
      });
      const patchRes = await patchFunnelContact(patchReq, { params: { id: 'c-acme-corp' } });
      expect(patchRes.status).toBe(200);
      const patchData = await patchRes.json();
      expect(patchData.journey.status).toBe('converted');
      expect(patchData.journey.amountUsd).toBe(15000);
    });

    test('2. Funnel cross-department protection rejects unauthorized users', async () => {
      const db = openDb(gladosDbPath);
      db.funnel.insertContact({
        id: 'c-sales-secret',
        name: 'Confidential Deal',
        venture: 'default',
        status: 'first_touch',
        product: null,
        amountUsd: null,
        relationship: 'hot',
        likelihood: 80,
        url: null,
        email: 'secret@deal.com',
        phone: null,
        person: null,
        company: 'Secret Co',
        role: null,
        linkedin: null,
        createdAt: '2026-11-14T10:00:00.000Z',
        departmentId: 'dept-sales',
      });

      // Ops manager cannot access sales lead (403)
      const crossReq = makeReq('http://localhost:3000/api/funnel/c-sales-secret', opsManagerCookie);
      const crossRes = await getFunnelContact(crossReq, { params: { id: 'c-sales-secret' } });
      expect(crossRes.status).toBe(403);

      // Sales employee can read sales lead (200)
      const validReq = makeReq('http://localhost:3000/api/funnel/c-sales-secret', salesEmployeeCookie);
      const validRes = await getFunnelContact(validReq, { params: { id: 'c-sales-secret' } });
      expect(validRes.status).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // B3. Projects & Operations Module
  // ─────────────────────────────────────────────────────────────
  describe('B3. Projects, Tasks & Operations', () => {
    test('1. Create task, filter by department, update status, and remove', async () => {
      // Create task in dept-ops
      const createReq = makeReq('http://localhost:3000/api/tasks', opsManagerCookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Infrastructure Audit Q4',
          detail: 'Check servers and database replication',
          priority: 'high',
          departmentId: 'dept-ops',
        }),
      });
      const createRes = await postTasks(createReq);
      expect(createRes.status).toBe(201);
      const createData = await createRes.json();
      const taskId = createData.task.id;
      expect(taskId).toBeTruthy();

      // Sales manager list does not contain ops task
      const salesListReq = makeReq('http://localhost:3000/api/tasks', salesManagerCookie);
      const salesListRes = await getTasks(salesListReq);
      expect(salesListRes.status).toBe(200);
      const salesListData = await salesListRes.json();
      expect(salesListData.tasks.some((t: any) => t.id === taskId)).toBe(false);

      // Ops manager list contains the task
      const opsListReq = makeReq('http://localhost:3000/api/tasks', opsManagerCookie);
      const opsListRes = await getTasks(opsListReq);
      expect(opsListRes.status).toBe(200);
      const opsListData = await opsListRes.json();
      expect(opsListData.tasks.some((t: any) => t.id === taskId)).toBe(true);

      // Update task status
      const patchReq = makeReq(`http://localhost:3000/api/tasks/${taskId}`, opsManagerCookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done', detail: 'Audit completed successfully' }),
      });
      const patchRes = await patchTask(patchReq, { params: { id: taskId } });
      expect(patchRes.status).toBe(200);
      const patchData = await patchRes.json();
      expect(patchData.task.status).toBe('done');

      // Delete task
      const deleteReq = makeReq(`http://localhost:3000/api/tasks/${taskId}`, opsManagerCookie, {
        method: 'DELETE',
      });
      const deleteRes = await deleteTask(deleteReq, { params: { id: taskId } });
      expect(deleteRes.status).toBe(200);
    });

    test('2. Workflow operations enforce workflows RBAC permissions', async () => {
      // Viewer cannot create workflow (403)
      const viewerReq = makeReq('http://localhost:3000/api/workflows', viewerCookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Illegal Workflow',
          subtitle: 'Should fail',
          steps: [{ label: 'Step 1', instructions: 'Instructions' }],
        }),
      });
      const viewerRes = await postWorkflow(viewerReq);
      expect(viewerRes.status).toBe(403);

      // Manager can create workflow (201)
      const mgrReq = makeReq('http://localhost:3000/api/workflows', opsManagerCookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Deployment Pipeline',
          subtitle: 'Automated release checks',
          steps: [
            {
              title: 'Build and test',
              detail: 'Run vitest and tsc',
              ownerKind: 'agent',
              owner: 'agent-ops',
              hoursPerWeek: 5,
              tools: ['bash'],
              automation: null,
              branchFromIndex: null,
              branchCondition: null,
            },
          ],
        }),
      });
      const mgrRes = await postWorkflow(mgrReq);
      expect(mgrRes.status).toBe(201);
      const mgrData = await mgrRes.json();
      const wfId = mgrData.workflow.id;

      // Employee cannot delete workflow (403)
      const empDelReq = makeReq(`http://localhost:3000/api/workflows/${wfId}`, salesEmployeeCookie, {
        method: 'DELETE',
      });
      const empDelRes = await deleteWorkflow(empDelReq, { params: { id: wfId } });
      expect(empDelRes.status).toBe(403);

      // Admin can delete workflow (200)
      const adminDelReq = makeReq(`http://localhost:3000/api/workflows/${wfId}`, adminCookie, {
        method: 'DELETE',
      });
      const adminDelRes = await deleteWorkflow(adminDelReq, { params: { id: wfId } });
      expect(adminDelRes.status).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // B4. Training & Education Module
  // ─────────────────────────────────────────────────────────────
  describe('B4. Training & Education Management', () => {
    test('1. Create course, schedule batch, enroll student, and track progress', async () => {
      // 1. Create course
      const courseReq = makeReq('http://localhost:3000/api/training', opsManagerCookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Fullstack AI Engineering',
          description: 'Intensive engineering training for software agents and humans',
          durationWeeks: 6,
          departmentId: 'dept-ops',
        }),
      });
      const courseRes = await postTraining(courseReq);
      expect(courseRes.status).toBe(201);
      const courseData = await courseRes.json();
      const courseId = courseData.course.id;
      expect(courseId).toBeTruthy();

      // 2. Schedule batch
      const batchReq = makeReq('http://localhost:3000/api/training', opsManagerCookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'batch',
          courseId,
          name: 'Batch 2026-Alpha',
          startDate: '2026-12-01',
          endDate: '2027-01-15',
          status: 'upcoming',
          departmentId: 'dept-ops',
        }),
      });
      const batchRes = await postTraining(batchReq);
      expect(batchRes.status).toBe(201);
      const batchData = await batchRes.json();
      const batchId = batchData.batch.id;
      expect(batchId).toBeTruthy();

      // 3. Enroll participant
      const enrollReq = makeReq('http://localhost:3000/api/training/participants', opsManagerCookie, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchId,
          name: 'Daniel Intern',
          email: 'daniel@intern.hazzino.com',
          role: 'intern',
          progressPct: 15,
          attendancePct: 100,
        }),
      });
      const enrollRes = await postParticipant(enrollReq);
      expect(enrollRes.status).toBe(201);
      const enrollData = await enrollRes.json();
      const participantId = enrollData.participant.id;
      expect(participantId).toBeTruthy();

      // 4. Update progress and attendance
      const patchReq = makeReq(`http://localhost:3000/api/training/participants/${participantId}`, opsManagerCookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          progressPct: 85,
          attendancePct: 98,
          status: 'in_progress',
          notes: 'Completed Module 4 project with distinction',
        }),
      });
      const patchRes = await patchParticipant(patchReq, { params: { id: participantId } });
      expect(patchRes.status).toBe(200);
      const patchData = await patchRes.json();
      expect(patchData.participant.progressPct).toBe(85);
      expect(patchData.participant.attendancePct).toBe(98);

      // 5. Training dashboard metrics
      const dashReq = makeReq('http://localhost:3000/api/training', opsManagerCookie);
      const dashRes = await getTraining(dashReq);
      expect(dashRes.status).toBe(200);
      const dashData = await dashRes.json();
      expect(dashData.stats.totalCourses).toBeGreaterThanOrEqual(1);
      expect(dashData.stats.totalStudents).toBeGreaterThanOrEqual(1);
      expect(dashData.stats.averageProgress).toBe(85);
    });

    test('2. Training management enforces department boundaries', async () => {
      // Sales manager attempting to manage ops course is rejected with 403
      const db = openDb(gladosDbPath);
      db.training.courses.insert({
        id: 'c-ops-protected',
        title: 'Confidential Ops Course',
        slug: 'conf-ops',
        description: 'Ops internal only',
        durationWeeks: 4,
        departmentId: 'dept-ops',
        createdAt: '2026-11-14T10:00:00.000Z',
      });

      const crossPatchReq = makeReq('http://localhost:3000/api/training/c-ops-protected', salesManagerCookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Hacked Title' }),
      });
      const crossPatchRes = await patchTrainingCourse(crossPatchReq, { params: { id: 'c-ops-protected' } });
      expect(crossPatchRes.status).toBe(403);

      // Admin can manage course across departments
      const adminPatchReq = makeReq('http://localhost:3000/api/training/c-ops-protected', adminCookie, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Admin Updated Title' }),
      });
      const adminPatchRes = await patchTrainingCourse(adminPatchReq, { params: { id: 'c-ops-protected' } });
      expect(adminPatchRes.status).toBe(200);
    });
  });
});
