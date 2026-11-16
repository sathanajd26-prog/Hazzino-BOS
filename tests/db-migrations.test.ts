import { afterEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  migrateAgentsTable,
  migrateFunnelContactsTable,
  migrateSkillsTable,
  migrateAgentTasksTable,
  migrateWorkflowsTable,
  migrateFounderOs,
  openDb,
  FO_TABLES,
  type GladosDb,
} from '@/lib/db';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glados-migrate-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on busy handles
    }
  }
});

describe('Phase 2 Migration Safety & Idempotency', () => {
  test('1. Each migration is idempotent and safe when invoked repeatedly on the same database', () => {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');

    // Setup base tables without the migrated columns
    db.exec(`
      CREATE TABLE agents (id TEXT PRIMARY KEY, department_id TEXT, name TEXT, role TEXT, status TEXT, tier TEXT, description TEXT, model TEXT, tools TEXT);
      CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT, subtitle TEXT, revenue_usd INTEGER, ord INTEGER, steps TEXT);
      CREATE TABLE funnel_contacts (id TEXT PRIMARY KEY, name TEXT, venture TEXT, status TEXT, created_at TEXT);
      CREATE TABLE agent_tasks (id TEXT PRIMARY KEY, agent_id TEXT, title TEXT, status TEXT, created_at TEXT);
      CREATE TABLE skills (id TEXT PRIMARY KEY, name TEXT, category TEXT, description TEXT, owner_agent_id TEXT, status TEXT, tools TEXT, ord INTEGER);
      CREATE TABLE cron_runs (id TEXT PRIMARY KEY, cron_id TEXT, agent_id TEXT, started_at TEXT, finished_at TEXT, ok INTEGER, summary TEXT);
    `);

    // Call each migration twice in succession
    migrateAgentsTable(db);
    migrateAgentsTable(db);

    migrateWorkflowsTable(db);
    migrateWorkflowsTable(db);

    migrateFunnelContactsTable(db);
    migrateFunnelContactsTable(db);

    migrateAgentTasksTable(db);
    migrateAgentTasksTable(db);

    migrateSkillsTable(db);
    migrateSkillsTable(db);

    migrateFounderOs(db);
    migrateFounderOs(db);

    // Verify all expected columns are present
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);

    expect(cols('agents')).toContain('parent_id');
    expect(cols('agents')).toContain('instance');

    expect(cols('workflows')).toContain('ratio_target');

    expect(cols('funnel_contacts')).toEqual(
      expect.arrayContaining(['relationship', 'likelihood', 'email', 'phone', 'person', 'company', 'role', 'linkedin']),
    );

    expect(cols('agent_tasks')).toEqual(
      expect.arrayContaining(['detail', 'due_at', 'priority', 'owner_kind', 'horizon', 'run_id']),
    );

    expect(cols('skills')).toContain('markdown');
    expect(cols('cron_runs')).toContain('trigger');

    db.close();
  });

  test('2. Legacy schemas receive expected columns while preserving existing rows', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO agents (id, name) VALUES ('ag-1', 'Atlas');
      CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO workflows (id, name) VALUES ('wf-1', 'Growth Engine');
      CREATE TABLE funnel_contacts (id TEXT PRIMARY KEY, name TEXT, created_at TEXT);
      INSERT INTO funnel_contacts (id, name, created_at) VALUES ('c-1', 'Alice', '2026-10-01');
      CREATE TABLE agent_tasks (id TEXT PRIMARY KEY, title TEXT);
      INSERT INTO agent_tasks (id, title) VALUES ('t-1', 'Review copy');
    `);

    migrateAgentsTable(db);
    migrateWorkflowsTable(db);
    migrateFunnelContactsTable(db);
    migrateAgentTasksTable(db);

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get('ag-1') as Record<string, unknown>;
    expect(agent.name).toBe('Atlas');
    expect(agent.parent_id).toBeNull();
    expect(agent.instance).toBe('builtin');

    const wf = db.prepare('SELECT * FROM workflows WHERE id = ?').get('wf-1') as Record<string, unknown>;
    expect(wf.name).toBe('Growth Engine');
    expect(wf.ratio_target).toBeNull();

    const contact = db.prepare('SELECT * FROM funnel_contacts WHERE id = ?').get('c-1') as Record<string, unknown>;
    expect(contact.name).toBe('Alice');
    expect(contact.relationship).toBe('warm');
    expect(contact.likelihood).toBe(50);

    const task = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get('t-1') as Record<string, unknown>;
    expect(task.title).toBe('Review copy');
    expect(task.detail).toBe('');
    expect(task.priority).toBe('normal');

    db.close();
  });

  test('3. Existing current-schema skill records are preserved across migrateSkillsTable calls', () => {
    const db = new Database(':memory:');
    // Current DDL schema already has markdown
    db.exec(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        owner_agent_id TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        tools TEXT NOT NULL DEFAULT '[]',
        markdown TEXT NOT NULL DEFAULT '',
        ord INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO skills (id, name, category, markdown) VALUES ('sk-1', 'Code Review', 'Engineering', '# Guide');
    `);

    // Call migrateSkillsTable multiple times
    migrateSkillsTable(db);
    migrateSkillsTable(db);

    const rows = db.prepare('SELECT * FROM skills').all() as Array<{ id: string; name: string; markdown: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('sk-1');
    expect(rows[0].markdown).toBe('# Guide');

    db.close();
  });

  test('4. Legacy skills cleanup occurs strictly when markdown column is missing', () => {
    const db = new Database(':memory:');
    // Legacy schema: no markdown column
    db.exec(`
      CREATE TABLE skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        owner_agent_id TEXT,
        status TEXT NOT NULL DEFAULT 'planned',
        tools TEXT NOT NULL DEFAULT '[]',
        ord INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO skills (id, name, category) VALUES ('legacy-1', 'Legacy Skill', 'Legacy');
    `);

    expect(db.prepare('SELECT count(*) as count FROM skills').get()).toEqual({ count: 1 });

    // Initial upgrade: markdown missing -> ALTER TABLE and DELETE FROM skills runs
    migrateSkillsTable(db);

    expect(db.prepare('SELECT count(*) as count FROM skills').get()).toEqual({ count: 0 });

    // Now insert a post-migration skill row
    db.prepare("INSERT INTO skills (id, name, category, markdown) VALUES ('new-1', 'New Skill', 'General', '# Markdown')").run();
    expect(db.prepare('SELECT count(*) as count FROM skills').get()).toEqual({ count: 1 });

    // Second call: markdown is present -> DELETE must NOT run
    migrateSkillsTable(db);
    expect(db.prepare('SELECT count(*) as count FROM skills').get()).toEqual({ count: 1 });
    const row = db.prepare('SELECT * FROM skills WHERE id = ?').get('new-1') as { id: string; name: string };
    expect(row.name).toBe('New Skill');

    db.close();
  });

  test('5. migrateFounderOs remains compatible with legacy table renames and existing upgrades', () => {
    const db = new Database(':memory:');
    const NOW = '2026-10-13T09:00:00.000Z';
    // Parts-bin legacy tables
    db.exec(`
      CREATE TABLE comms_digests (id TEXT PRIMARY KEY, generated_at TEXT NOT NULL, payload TEXT NOT NULL);
      INSERT INTO comms_digests VALUES ('d1', '${NOW}', '{"legacy": true}');
      CREATE TABLE digest_reads (key TEXT PRIMARY KEY, read_at TEXT NOT NULL);
      INSERT INTO digest_reads VALUES ('k1', '${NOW}');
      CREATE TABLE cron_runs (id TEXT PRIMARY KEY, cron_id TEXT, agent_id TEXT, started_at TEXT, finished_at TEXT, ok INTEGER, summary TEXT);
      INSERT INTO cron_runs VALUES ('cr-1', 'c1', 'a1', '${NOW}', '${NOW}', 1, 'ok');
    `);

    migrateFounderOs(db);

    // Legacy tables preserved under *_v0
    expect((db.prepare('SELECT count(*) as n FROM comms_digests_v0').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT count(*) as n FROM digest_reads_v0').get() as { n: number }).n).toBe(1);

    // New FO tables created
    for (const table of FO_TABLES) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      expect(exists, `Expected table ${table} to exist`).toBeDefined();
    }

    // trigger column added to cron_runs with default
    const cron = db.prepare('SELECT trigger FROM cron_runs WHERE id = ?').get('cr-1') as { trigger: string };
    expect(cron.trigger).toBe('schedule');

    // Repeated call preserves everything
    migrateFounderOs(db);
    expect((db.prepare('SELECT count(*) as n FROM comms_digests_v0').get() as { n: number }).n).toBe(1);

    db.close();
  });

  test('6. Two independent database connections on the same temporary SQLite file initialize safely', () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, 'concurrent-test.db');

    // First connection initializes schema
    const conn1 = openDb(dbPath);
    conn1.departments.insert({
      id: 'dept-tech',
      name: 'Tech',
      slug: 'tech',
      tagline: '',
      color: '#fff',
      order: 1,
    });
    conn1.agents.insert({
      id: 'agent-alpha',
      departmentId: 'dept-tech',
      name: 'Alpha',
      role: 'Tester',
      status: 'active',
      tier: 'lead',
      description: 'First agent',
      model: 'builtin',
      tools: [],
      parentId: null,
      instance: 'builtin',
    });

    // Second connection opens the same file simultaneously
    const conn2 = openDb(dbPath);
    const agent = conn2.agents.get('agent-alpha');
    expect(agent?.name).toBe('Alpha');

    // Two separate SQLite handles on the same file run migrations concurrently
    const raw1 = new Database(dbPath);
    const raw2 = new Database(dbPath);

    migrateAgentsTable(raw1);
    migrateAgentsTable(raw2);

    migrateWorkflowsTable(raw1);
    migrateWorkflowsTable(raw2);

    migrateFunnelContactsTable(raw1);
    migrateFunnelContactsTable(raw2);

    migrateAgentTasksTable(raw1);
    migrateAgentTasksTable(raw2);

    migrateSkillsTable(raw1);
    migrateSkillsTable(raw2);

    migrateFounderOs(raw1);
    migrateFounderOs(raw2);

    raw1.close();
    raw2.close();
    conn1.close();
    conn2.close();
  });
});
