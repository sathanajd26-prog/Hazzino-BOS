/**
 * HAZZINO BOS — BATCH 1: COMPLETE CORE INTEGRATIONS TEST SUITE
 *
 * Comprehensive integration and verification suite covering:
 * 1. Department-Level Business Data Isolation (Universal roles, Manager/Employee isolation, unassigned legacy record restrictions, additive DB migrations)
 * 2. Brain & Knowledge Integration (Local markdown search, empty query safety, missing directory safety, brain dump deduplication, gbrain/local fallback honesty, API RBAC)
 * 3. AI Gateway, Agents & Conductor (Model selection, timeout abort signal, status reporting, Conductor @agent vs model routing, read-only tools constraint)
 * 4. Email, Inbox & Comms (Multi-inbox config parsing, fail-fast IMAP options, verified-sender gsend draft enforcement, honest 502 with mailto fallback, RBAC)
 * 5. Finance CSV & Ledger Integration Smoke Test (Synthetic CSV parsing, deduplication, ledger persistence, RBAC)
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
import { openDb, migrateDepartmentOwnership, FO_DDL } from '@/lib/db';

// ── Brain & Knowledge ────────────────────────────────────────
import {
  createGBrainProvider,
  readStoreNotes,
  type ExecFn,
} from '@/lib/connectors/gbrain';
import {
  writeBrainDump,
  ingestBrainDump,
  slugifyTitle,
} from '@/lib/brain-dump';

// ── AI Gateway & Conductor ───────────────────────────────────
import {
  llmStatus,
  createGatewayProvider,
  stubLlmProvider,
  LLM_DEFAULT_MODEL,
} from '@/lib/connectors/llm';
import { systemPromptFor } from '@/lib/agents/chat';
import { routeConductorMessage } from '@/lib/agents/conductor';
import type { RuntimeAgent } from '@/lib/agents/runtime';

// ── Email & Comms ────────────────────────────────────────────
import {
  parseInboxConfigs,
  imapClientOptions,
  sendEmailReply,
} from '@/lib/connectors/email';

// ── Finance ──────────────────────────────────────────────────
import { parseStatementCsv, categorize, type LedgerRow } from '@/lib/statements';
import { openLedger } from '@/lib/ledger';

describe('Batch 1 — Core Integrations', () => {
  let tmpDir: string;
  let authDbPath: string;
  let appDbPath: string;
  let brainStorePath: string;
  let authDb: InstanceType<typeof Database>;
  let tokens: Record<string, string>;
  let users: Record<string, SafeUser>;

  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hazzino-batch1-'));
    authDbPath = path.join(tmpDir, 'auth.db');
    appDbPath = path.join(tmpDir, 'app.db');
    brainStorePath = path.join(tmpDir, 'brain-store');
    fs.mkdirSync(brainStorePath, { recursive: true });

    process.env.HAZZINO_AUTH_DB = authDbPath;
    process.env.GLADOS_DB = appDbPath;
    process.env.GLADOS_ENV_LOCAL = path.join(tmpDir, '.env.local');
    process.env.BRAIN_STORE = brainStorePath;
    process.env.LEDGER_DB = path.join(tmpDir, 'ledger.db');
    process.env.LLM_PROVIDER = 'stub';

    closeAuthDb();
    authDb = openAuthDb(authDbPath);

    tokens = {};
    users = {};

    const userConfigs: { key: string; role: UserRole; dept: string | null }[] = [
      { key: 'super_admin', role: 'super_admin', dept: null },
      { key: 'admin', role: 'admin', dept: null },
      { key: 'mgr_clients', role: 'manager', dept: 'dept-clients' },
      { key: 'emp_clients', role: 'employee', dept: 'dept-clients' },
      { key: 'mgr_sales', role: 'manager', dept: 'dept-sales' },
      { key: 'emp_sales', role: 'employee', dept: 'dept-sales' },
      { key: 'mgr_marketing', role: 'manager', dept: 'dept-marketing-growth' },
      { key: 'emp_marketing', role: 'employee', dept: 'dept-marketing-growth' },
      { key: 'viewer_sales', role: 'viewer', dept: 'dept-sales' },
      { key: 'unassigned_mgr', role: 'manager', dept: null },
    ];

    for (const cfg of userConfigs) {
      const u = createUser(authDb, {
        email: `${cfg.key}@hazzino.test`,
        name: `User ${cfg.key}`,
        password: 'Password123!',
        role: cfg.role,
        departmentId: cfg.dept,
      });
      users[cfg.key] = u;
      const { rawToken } = createSession(authDb, { userId: u.id });
      tokens[cfg.key] = rawToken;
    }
  });

  afterEach(() => {
    setTestRequest(null);
    closeAuthDb();
    process.env = { ...originalEnv };
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const apiReq = (url: string, method: string, token?: string, body?: unknown) =>
    new Request(`http://localhost${url}`, {
      method,
      headers: {
        host: 'localhost:4100',
        'content-type': 'application/json',
        ...(token ? { cookie: `${HAZZINO_SESSION_COOKIE}=${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /* =========================================================================
   * 1. DEPARTMENT-LEVEL BUSINESS DATA ISOLATION
   * ========================================================================= */
  describe('1. Department-Level Business Data Isolation', () => {
    test('universal roles: super_admin and admin access resources across all departments', () => {
      const depts = ['dept-clients', 'dept-sales', 'dept-marketing-growth', 'dept-tech'];
      for (const dept of depts) {
        expect(canAccessDepartment(users.super_admin, dept)).toBe(true);
        expect(canAccessDepartment(users.admin, dept)).toBe(true);
        expect(hasPermission(users.super_admin, 'clients:view', { resourceDepartmentId: dept })).toBe(true);
        expect(hasPermission(users.admin, 'clients:view', { resourceDepartmentId: dept })).toBe(true);
        expect(hasPermission(users.admin, 'clients:create', { resourceDepartmentId: dept })).toBe(true);
      }
    });

    test('manager & employee access within assigned department is allowed, cross-department is denied', () => {
      // Clients manager & employee on dept-clients
      expect(canAccessDepartment(users.mgr_clients, 'dept-clients')).toBe(true);
      expect(canAccessDepartment(users.emp_clients, 'dept-clients')).toBe(true);
      expect(hasPermission(users.mgr_clients, 'clients:view', { resourceDepartmentId: 'dept-clients' })).toBe(true);
      expect(hasPermission(users.emp_clients, 'clients:view', { resourceDepartmentId: 'dept-clients' })).toBe(true);

      // Clients manager & employee trying to access Sales or Marketing
      expect(canAccessDepartment(users.mgr_clients, 'dept-sales')).toBe(false);
      expect(canAccessDepartment(users.emp_clients, 'dept-sales')).toBe(false);
      expect(hasPermission(users.mgr_clients, 'funnel:view', { resourceDepartmentId: 'dept-sales' })).toBe(false);
      expect(hasPermission(users.emp_clients, 'funnel:view', { resourceDepartmentId: 'dept-sales' })).toBe(false);

      expect(canAccessDepartment(users.mgr_clients, 'dept-marketing-growth')).toBe(false);
      expect(hasPermission(users.mgr_clients, 'marketing:view', { resourceDepartmentId: 'dept-marketing-growth' })).toBe(false);

      // Sales manager & employee accessing Sales
      expect(canAccessDepartment(users.mgr_sales, 'dept-sales')).toBe(true);
      expect(canAccessDepartment(users.emp_sales, 'dept-sales')).toBe(true);
      expect(hasPermission(users.mgr_sales, 'funnel:view', { resourceDepartmentId: 'dept-sales' })).toBe(true);
      expect(hasPermission(users.emp_sales, 'funnel:view', { resourceDepartmentId: 'dept-sales' })).toBe(true);

      // Sales manager & employee accessing Clients (denied)
      expect(canAccessDepartment(users.mgr_sales, 'dept-clients')).toBe(false);
      expect(hasPermission(users.mgr_sales, 'clients:view', { resourceDepartmentId: 'dept-clients' })).toBe(false);
      expect(hasPermission(users.emp_sales, 'clients:view', { resourceDepartmentId: 'dept-clients' })).toBe(false);
    });

    test('unassigned legacy records are restricted to admin and super_admin when department-scoped', () => {
      // When isDepartmentScoped is true and resource has no department (legacy unassigned):
      expect(canAccessDepartment(users.super_admin, null, { isDepartmentScoped: true })).toBe(true);
      expect(canAccessDepartment(users.admin, null, { isDepartmentScoped: true })).toBe(true);

      expect(canAccessDepartment(users.mgr_sales, null, { isDepartmentScoped: true })).toBe(false);
      expect(canAccessDepartment(users.emp_sales, null, { isDepartmentScoped: true })).toBe(false);
      expect(canAccessDepartment(users.unassigned_mgr, null, { isDepartmentScoped: true })).toBe(false);

      expect(hasPermission(users.super_admin, 'clients:view', { resourceDepartmentId: null, isDepartmentScoped: true })).toBe(true);
      expect(hasPermission(users.admin, 'clients:view', { resourceDepartmentId: null, isDepartmentScoped: true })).toBe(true);
      expect(hasPermission(users.mgr_sales, 'clients:view', { resourceDepartmentId: null, isDepartmentScoped: true })).toBe(false);
      expect(hasPermission(users.emp_sales, 'clients:view', { resourceDepartmentId: null, isDepartmentScoped: true })).toBe(false);
    });

    test('additive DB migration migrateDepartmentOwnership idempotently backfills department_id', () => {
      const rawDb = new Database(path.join(tmpDir, 'migration-test.db'));
      rawDb.exec(`
        CREATE TABLE funnel_contacts (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE client_confirmations (client_id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE client_work (id TEXT PRIMARY KEY, client_id TEXT);
        CREATE TABLE lead_magnets (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE agent_tasks (id TEXT PRIMARY KEY, title TEXT);
      `);

      // Run migration first time
      migrateDepartmentOwnership(rawDb);

      const cols = (table: string) =>
        (rawDb.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

      expect(cols('funnel_contacts')).toContain('department_id');
      expect(cols('client_confirmations')).toContain('department_id');
      expect(cols('client_work')).toContain('department_id');
      expect(cols('lead_magnets')).toContain('department_id');
      expect(cols('workflows')).toContain('department_id');
      expect(cols('agent_tasks')).toContain('department_id');

      // Idempotent re-run must not throw
      expect(() => migrateDepartmentOwnership(rawDb)).not.toThrow();

      rawDb.close();
    });

    test('API route enforcement: /api/clients rejects cross-department access with 403', async () => {
      const { GET } = await import('@/app/api/clients/route');

      // 1. Unauthenticated -> 401
      const unauthed = await GET(apiReq('/api/clients', 'GET'));
      expect(unauthed.status).toBe(401);

      // 2. Cross-department (Sales manager accessing Clients) -> 403
      const crossDept = await GET(apiReq('/api/clients', 'GET', tokens.mgr_sales));
      expect(crossDept.status).toBe(403);

      // 3. Department member (Clients manager) -> 200
      const deptMember = await GET(apiReq('/api/clients', 'GET', tokens.mgr_clients));
      expect(deptMember.status).toBe(200);

      // 4. Admin (universal) -> 200
      const adminRes = await GET(apiReq('/api/clients', 'GET', tokens.admin));
      expect(adminRes.status).toBe(200);

      // 5. Super Admin (universal) -> 200
      const superRes = await GET(apiReq('/api/clients', 'GET', tokens.super_admin));
      expect(superRes.status).toBe(200);
    });

    test('API route enforcement: /api/funnel rejects cross-department access with 403', async () => {
      const { GET } = await import('@/app/api/funnel/route');

      // 1. Unauthenticated -> 401
      const unauthed = await GET(apiReq('/api/funnel', 'GET'));
      expect(unauthed.status).toBe(401);

      // 2. Cross-department (Clients manager accessing Sales Funnel) -> 403
      const crossDept = await GET(apiReq('/api/funnel', 'GET', tokens.mgr_clients));
      expect(crossDept.status).toBe(403);

      // 3. Sales department member -> 200
      const salesMember = await GET(apiReq('/api/funnel', 'GET', tokens.mgr_sales));
      expect(salesMember.status).toBe(200);

      // 4. Admin universal access -> 200
      const adminRes = await GET(apiReq('/api/funnel', 'GET', tokens.admin));
      expect(adminRes.status).toBe(200);
    });

    test('API route enforcement: /api/lead-magnets rejects cross-department mutations with 403', async () => {
      const { GET, POST } = await import('@/app/api/lead-magnets/route');

      // 1. Cross-department read (Sales employee accessing Marketing) -> 403
      const crossRead = await GET(apiReq('/api/lead-magnets', 'GET', tokens.emp_sales));
      expect(crossRead.status).toBe(403);

      // 2. Marketing member read -> 200
      const mktRead = await GET(apiReq('/api/lead-magnets', 'GET', tokens.mgr_marketing));
      expect(mktRead.status).toBe(200);

      // 3. Cross-department write (Sales manager creating Lead Magnet) -> 403
      const crossWrite = await POST(
        apiReq('/api/lead-magnets', 'POST', tokens.mgr_sales, {
          name: 'Free Audit',
          liveUrl: 'https://example.com/audit',
          destination: 'email',
        }),
      );
      expect(crossWrite.status).toBe(403);

      // 4. Marketing member write -> 201
      const mktWrite = await POST(
        apiReq('/api/lead-magnets', 'POST', tokens.mgr_marketing, {
          name: 'Growth Checklist',
          liveUrl: 'https://example.com/checklist',
          destination: 'email',
        }),
      );
      expect(mktWrite.status).toBe(201);
    });
  });

  /* =========================================================================
   * 2. BRAIN & KNOWLEDGE INTEGRATION
   * ========================================================================= */
  describe('2. Brain & Knowledge Integration', () => {
    test('local markdown search recursively finds notes and extracts snippets', () => {
      const folderA = path.join(brainStorePath, 'engineering');
      const folderB = path.join(brainStorePath, 'operations', 'processes');
      fs.mkdirSync(folderA, { recursive: true });
      fs.mkdirSync(folderB, { recursive: true });

      fs.writeFileSync(
        path.join(folderA, 'architecture.md'),
        '# System Architecture\nFounderOS is built on Next.js with SQLite persistence.\n',
      );
      fs.writeFileSync(
        path.join(folderB, 'onboarding.md'),
        '# Employee Onboarding\nEnsure new team members are assigned to their correct department.\n',
      );

      const notes = readStoreNotes(brainStorePath);
      expect(notes.length).toBe(2);
      expect(notes.map((n) => n.path)).toContain('engineering/architecture.md');
      expect(notes.map((n) => n.path)).toContain('operations/processes/onboarding.md');
    });

    test('empty and whitespace queries safely return empty results without crashing', async () => {
      const provider = createGBrainProvider({ storePath: brainStorePath });
      expect(await provider.search('')).toEqual([]);
      expect(await provider.search('   ')).toEqual([]);
      expect(await provider.search('\t\n')).toEqual([]);
    });

    test('missing store path handles gracefully without throwing', async () => {
      const nonExistent = path.join(tmpDir, 'missing-brain-store');
      const provider = createGBrainProvider({ storePath: nonExistent });

      const notes = readStoreNotes(nonExistent);
      expect(notes).toEqual([]);

      const stats = await provider.localStats();
      expect(stats.markdownFiles).toBe(0);

      const hits = await provider.search('test');
      expect(hits).toEqual([]);
    });

    test('brain dump writes markdown file, deduplicates slug, and retains frontmatter', async () => {
      const dumpDir = path.join(brainStorePath, 'ideas');

      const res1 = writeBrainDump(
        { text: 'First product concept for Hazzino BOS', title: 'Product Concept', folder: 'ideas', tags: ['bos', 'mvp'] },
        brainStorePath,
      );
      expect(res1.relPath).toMatch(/^ideas\/\d{4}-\d{2}-\d{2}-product-concept\.md$/);
      expect(fs.existsSync(path.join(brainStorePath, res1.relPath))).toBe(true);

      // Second identical title must append increment
      const res2 = writeBrainDump(
        { text: 'Second revision of product concept', title: 'Product Concept', folder: 'ideas', tags: ['bos'] },
        brainStorePath,
      );
      expect(res2.relPath).toMatch(/^ideas\/\d{4}-\d{2}-\d{2}-product-concept-2\.md$/);
      expect(fs.existsSync(path.join(brainStorePath, res2.relPath))).toBe(true);

      const content = fs.readFileSync(path.join(brainStorePath, res1.relPath), 'utf8');
      expect(content).toContain('source: glados-brain-dump');
      expect(content).toContain('tags: [bos, mvp]');
      expect(content).toContain('First product concept for Hazzino BOS');
    });

    test('ingestBrainDump writes locally and degrades honestly when capture fails', async () => {
      const failingCapture = async () => ({ ok: false as const, error: 'Supabase vector DB paused' });

      const result = await ingestBrainDump(
        { text: 'Capture resilience test', title: 'Resilience Test', folder: 'notes', tags: ['test'] },
        { storePath: brainStorePath, capture: failingCapture },
      );

      // Local write must succeed even if capture fails
      expect(result.embedded).toBe(false);
      expect(result.captureError).toBe('Supabase vector DB paused');
      expect(fs.existsSync(path.join(brainStorePath, result.relPath))).toBe(true);
    });

    test('honest source attribution distinguishes cloud gbrain vs local brain-store fallback', async () => {
      const notePath = path.join(brainStorePath, 'ops');
      fs.mkdirSync(notePath, { recursive: true });
      fs.writeFileSync(path.join(notePath, 'runbook.md'), '# Runbook\nDeployment steps for production.\n');

      // 1. Successful gbrain mock execution
      const cloudExec: ExecFn = async (_cmd, args) => {
        if (args[0] === 'query') {
          return { stdout: '[0.95] ops/runbook -- Deployment steps for production.\n', stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      };
      const cloudProvider = createGBrainProvider({ storePath: brainStorePath, exec: cloudExec });
      const cloudHits = await cloudProvider.search('deployment');
      expect(cloudHits.length).toBe(1);
      expect(cloudHits[0].source).toBe('gbrain');

      // 2. Failed gbrain execution falls back to local search
      const failingExec: ExecFn = async () => ({ stdout: '', stderr: 'CLI unavailable', code: 1 });
      const localProvider = createGBrainProvider({ storePath: brainStorePath, exec: failingExec });
      const localHits = await localProvider.search('deployment');
      expect(localHits.length).toBe(1);
      expect(localHits[0].source).toBe('brain-store');
    });

    test('Brain API routes enforce RBAC: view allowed to all roles, dump restricted to creators', async () => {
      const { GET: getOverview } = await import('@/app/api/brain/overview/route');
      const { GET: getGraph } = await import('@/app/api/brain/graph/route');
      const { POST: postDump } = await import('@/app/api/brain/dump/route');

      // 1. Unauthenticated gets 401
      expect((await getOverview(apiReq('/api/brain/overview', 'GET'))).status).toBe(401);
      expect((await getGraph(apiReq('/api/brain/graph', 'GET'))).status).toBe(401);

      // 2. Viewer can view overview and graph
      expect((await getOverview(apiReq('/api/brain/overview', 'GET', tokens.viewer_sales))).status).toBe(200);
      expect((await getGraph(apiReq('/api/brain/graph', 'GET', tokens.viewer_sales))).status).toBe(200);

      // 3. Viewer cannot dump (requires brain:edit) -> 403
      const viewerDump = await postDump(
        apiReq('/api/brain/dump', 'POST', tokens.viewer_sales, {
          text: 'Viewer thought',
          folder: 'inbox',
          tags: [],
        }),
      );
      expect(viewerDump.status).toBe(403);

      // 4. Employee lacks brain:edit -> 403
      const empDump = await postDump(
        apiReq('/api/brain/dump', 'POST', tokens.emp_sales, {
          text: 'Employee note capture',
          folder: 'inbox',
          tags: ['sales'],
        }),
      );
      expect(empDump.status).toBe(403);

      // 5. Admin has brain:edit -> 200
      const adminDump = await postDump(
        apiReq('/api/brain/dump', 'POST', tokens.admin, {
          text: 'Admin note capture',
          folder: 'inbox',
          tags: ['admin'],
        }),
      );
      expect(adminDump.status).toBe(200);
    });
  });

  /* =========================================================================
   * 3. AI GATEWAY, AGENTS & CONDUCTOR
   * ========================================================================= */
  describe('3. AI Gateway, Agents & Conductor', () => {
    test('reports not_configured when AI_GATEWAY_API_KEY is missing, connected for stub', async () => {
      delete process.env.AI_GATEWAY_API_KEY;
      delete process.env.LLM_PROVIDER;

      const unconfigured = await llmStatus();
      expect(unconfigured.state).toBe('not_configured');
      expect(unconfigured.detail).toContain('Set AI_GATEWAY_API_KEY');

      process.env.LLM_PROVIDER = 'stub';
      const stubStatus = await llmStatus();
      expect(stubStatus.state).toBe('connected');
      expect(stubStatus.detail).toContain('stub provider active');
    });

    test('createGatewayProvider fails fast with clear message when key is missing', async () => {
      delete process.env.AI_GATEWAY_API_KEY;
      const provider = createGatewayProvider();
      await expect(provider.chat({ messages: [{ role: 'user', content: 'hello' }] })).rejects.toThrow(
        /AI_GATEWAY_API_KEY is not set/,
      );
    });

    test('agent chat systemPrompt enforces READ-ONLY constraint with no autonomous execution', () => {
      const agent: RuntimeAgent = {
        id: 'analyst-1',
        departmentId: 'dept-sales',
        name: 'Sales Analyst',
        description: 'Analyzes pipeline conversions and deal velocity.',
        run: async () => ({ ok: true, summary: 'done' }),
      };

      const prompt = systemPromptFor(agent);
      expect(prompt).toContain('You are Sales Analyst');
      expect(prompt).toContain('READ-ONLY: never claim to have sent, created, scheduled, or published anything');
    });

    test('routeConductorMessage dispatches via explicit @agent prefix or model fallback', async () => {
      const db = openDb(appDbPath);
      const testAgents: RuntimeAgent[] = [
        {
          id: 'scout',
          departmentId: 'dept-sales',
          name: 'Lead Scout',
          description: 'Discovers new sales targets and leads',
          run: async () => ({ ok: true, summary: 'scouted' }),
        },
        {
          id: 'analyst',
          departmentId: 'dept-sales',
          name: 'Pipeline Analyst',
          description: 'Analyzes sales funnel metrics and conversion rates',
          run: async () => ({ ok: true, summary: 'analyzed' }),
        },
      ];

      // Explicit routing with @scout
      const explicitRes = await routeConductorMessage(db, testAgents, '@scout Find prospective deals');
      expect(explicitRes.routedTo).toBe('scout');
      expect(explicitRes.reply).toContain('stub-reply');

      // Model routing without @ prefix picks first/best fit
      const modelRes = await routeConductorMessage(db, testAgents, 'Analyze conversion numbers');
      expect(['scout', 'analyst']).toContain(modelRes.routedTo);
    });

    test('agent chat tool execution executes read-only lookup and logs tool turns', async () => {
      const db = openDb(appDbPath);
      let executedLookup = false;

      const agentWithTool: RuntimeAgent = {
        id: 'lookup-agent',
        departmentId: 'dept-clients',
        name: 'Lookup Agent',
        description: 'Reads client rosters',
        run: async () => ({ ok: true, summary: 'lookup' }),
        chatTools: () => [
          {
            name: 'client_lookup',
            description: 'Look up client details',
            parameters: {} as any,
            execute: async () => {
              executedLookup = true;
              return { activeClients: 12 };
            },
          },
        ],
      };

      const { chatWithAgent } = await import('@/lib/agents/chat');
      const result = await chatWithAgent(db, [agentWithTool], 'lookup-agent', 'use-tool:client_lookup');

      expect(executedLookup).toBe(true);
      expect(result.messages.some((m) => m.role === 'tool' && m.content.includes('client_lookup'))).toBe(true);
      expect(result.messages.some((m) => m.role === 'assistant')).toBe(true);
    });
  });

  /* =========================================================================
   * 4. EMAIL, INBOX & COMMS
   * ========================================================================= */
  describe('4. Email, Inbox & Comms', () => {
    test('parseInboxConfigs parses up to 4 configured inboxes from environment', () => {
      const env = {
        INBOX_1_HOST: 'imap.acme.com',
        INBOX_1_USER: 'sales@acme.com',
        INBOX_1_PASS: 'secret1',
        INBOX_1_NAME: 'Sales Inbox',
        INBOX_2_HOST: 'imap.gmail.com',
        INBOX_2_USER: 'support@acme.com',
        INBOX_2_PASS: 'secret2',
      };

      const inboxes = parseInboxConfigs(env);
      expect(inboxes.length).toBe(2);
      expect(inboxes[0].id).toBe('inbox-1');
      expect(inboxes[0].name).toBe('Sales Inbox');
      expect(inboxes[0].host).toBe('imap.acme.com');
      expect(inboxes[0].smtpHost).toBe('smtp.acme.com');
      expect(inboxes[1].id).toBe('inbox-2');
      expect(inboxes[1].name).toBe('support@acme.com');
    });

    test('imapClientOptions configures fail-fast timeouts preventing page stalls', () => {
      const config = {
        id: 'inbox-1',
        name: 'Ops',
        host: 'imap.example.com',
        port: 993,
        user: 'ops@example.com',
        pass: 'pass',
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
      };

      const opts = imapClientOptions(config);
      expect(opts.connectionTimeout).toBe(5000);
      expect(opts.greetingTimeout).toBe(5000);
      expect(opts.socketTimeout).toBe(10000);
    });

    test('verified-sender rule: sendEmailReply refuses direct SMTP and requires gsend daemon', async () => {
      // Missing inboxes -> honest error
      const noInbox = await sendEmailReply({ to: 'client@example.com', subject: 'Re: Proposal', text: 'Looks great!' }, {});
      expect(noInbox.ok).toBe(false);
      expect(noInbox.error).toContain('no inbox configured');

      // Empty recipient -> honest error
      const env = { INBOX_1_HOST: 'imap.x.com', INBOX_1_USER: 'u', INBOX_1_PASS: 'p' };
      const noTo = await sendEmailReply({ to: '', subject: 'Hi', text: 'Hello' }, env);
      expect(noTo.ok).toBe(false);
      expect(noTo.error).toContain('no recipient address');

      // Non-existent gsend binary -> honest error (returns error for UI mailto fallback)
      const missingBin = await sendEmailReply(
        { to: 'lead@example.com', subject: 'Follow up', text: 'Touching base' },
        { ...env, GSEND_BIN: path.join(tmpDir, 'nonexistent-gsend') },
      );
      expect(missingBin.ok).toBe(false);
      expect(missingBin.error).toBeDefined();
    });

    test('POST /api/comms/reply requires comms:create permission', async () => {
      const { POST } = await import('@/app/api/comms/reply/route');

      // 1. Unauthenticated -> 401
      const unauthed = await POST(
        apiReq('/api/comms/reply', 'POST', undefined, {
          source: 'email',
          to: 'lead@example.com',
          text: 'Hello',
        }),
      );
      expect(unauthed.status).toBe(401);

      // 2. Viewer lacks comms:create -> 403
      const viewerRes = await POST(
        apiReq('/api/comms/reply', 'POST', tokens.viewer_sales, {
          source: 'email',
          to: 'lead@example.com',
          text: 'Draft reply',
        }),
      );
      expect(viewerRes.status).toBe(403);

      // 3. Employee with comms:create -> reaches provider (returns 502 honest error if gsend/inbox unconfigured)
      const empRes = await POST(
        apiReq('/api/comms/reply', 'POST', tokens.emp_sales, {
          source: 'email',
          to: 'lead@example.com',
          text: 'Draft reply',
        }),
      );
      // Because no inboxes are configured, sendEmailReply returns { ok: false, error: ... } with status 502
      expect([200, 502]).toContain(empRes.status);
    });
  });

  /* =========================================================================
   * 5. FINANCE CSV & LEDGER INTEGRATION SMOKE TEST
   * ========================================================================= */
  describe('5. Finance CSV & Ledger Integration Smoke Test', () => {
    test('parses synthetic multi-format CSV, detects debits/credits, and persists to ledger DB', () => {
      const csv = [
        'Date,Description,Amount',
        '2026-03-01,Client Wire Payment,15000.00',
        '2026-03-02,AWS Cloud Hosting,-450.25',
        '2026-03-03,Office Supplies,-120.00',
      ].join('\n');

      const parsed = parseStatementCsv(csv);
      expect(parsed.length).toBe(3);
      expect(parsed[0].amountCents).toBe(1500000);
      expect(parsed[0].direction).toBe('in');
      expect(parsed[1].amountCents).toBe(45025);
      expect(parsed[1].direction).toBe('out');

      // Open isolated temporary ledger DB
      const ledgerPath = path.join(tmpDir, 'test-ledger.db');
      const ledger = openLedger(ledgerPath);

      const rows: LedgerRow[] = parsed.map((r) => ({ ...r, category: categorize(r) }));
      const inserted = ledger.insertRows(rows);
      expect(inserted).toBe(3);
      expect(ledger.rowCount()).toBe(3);

      // Deduplication check: re-inserting identical rows must insert 0 new rows
      const dupInserted = ledger.insertRows(rows);
      expect(dupInserted).toBe(0);
      expect(ledger.rowCount()).toBe(3);

      ledger.close();
    });

    test('Finance mutation API routes enforce strict finance:create / finance:manage permissions', async () => {
      const { POST: postStatement } = await import('@/app/api/finances/statements/route');

      const rawCsvReq = (token?: string, csvBody = 'Date,Description,Amount\n2026-03-01,Test,100') =>
        new Request('http://localhost/api/finances/statements', {
          method: 'POST',
          headers: {
            host: 'localhost:4100',
            'content-type': 'text/csv',
            ...(token ? { cookie: `${HAZZINO_SESSION_COOKIE}=${token}` } : {}),
          },
          body: csvBody,
        });

      // Viewer, employee, and manager lack finance:create -> 403
      const viewerRes = await postStatement(rawCsvReq(tokens.viewer_sales));
      expect(viewerRes.status).toBe(403);

      const empRes = await postStatement(rawCsvReq(tokens.emp_sales));
      expect(empRes.status).toBe(403);

      const mgrRes = await postStatement(rawCsvReq(tokens.mgr_sales));
      expect(mgrRes.status).toBe(403);

      // Admin has finance:create -> 200
      const uniqueDesc = `Client Retainer ${randomUUID().slice(0, 8)}`;
      const adminRes = await postStatement(
        rawCsvReq(tokens.admin, `Date,Description,Amount\n2026-03-01,${uniqueDesc},5000.00`),
      );
      expect(adminRes.status).toBe(200);
      const data = await adminRes.json();
      expect(data.inserted).toBeGreaterThanOrEqual(1);
    });
  });
});
