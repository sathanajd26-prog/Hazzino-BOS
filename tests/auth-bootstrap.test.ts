import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { closeAuthDb, getAuthDb, openAuthDb } from '@/lib/auth/db';
import { bootstrapSuperAdmin } from '@/scripts/bootstrap-super-admin';
import { listUsers } from '@/lib/auth/users';
import { listAuditLogs } from '@/lib/auth/audit';

let tmpDir: string;
let testDbPath: string;
const prevAuthDb = process.env.HAZZINO_AUTH_DB;

beforeEach(() => {
  closeAuthDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hazzino-bootstrap-test-'));
  testDbPath = path.join(tmpDir, 'auth.db');
  process.env.HAZZINO_AUTH_DB = testDbPath;
  openAuthDb(testDbPath);
});

afterAll(() => {
  closeAuthDb();
  if (prevAuthDb === undefined) delete process.env.HAZZINO_AUTH_DB;
  else process.env.HAZZINO_AUTH_DB = prevAuthDb;
});

describe('Phase 5D-2: First Super Admin Bootstrap', () => {
  test('bootstraps first Super Admin successfully on uninitialized database', async () => {
    expect(listUsers().length).toBe(0);

    const admin = await bootstrapSuperAdmin({
      name: 'Initial Operator',
      email: 'founder@hazzino.com',
      password: 'BootstrapPassword2026!',
    });

    expect(admin.id).toBeDefined();
    expect(admin.name).toBe('Initial Operator');
    expect(admin.email).toBe('founder@hazzino.com');
    expect(admin.role).toBe('super_admin');
    expect((admin as any).password_hash).toBeUndefined();

    // Verify persisted in DB
    const users = listUsers();
    expect(users.length).toBe(1);
    expect(users[0].role).toBe('super_admin');

    // Audit log was created
    const logs = listAuditLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].action).toBe('bootstrap_super_admin');
  });

  test('refuses to bootstrap another Super Admin once initialized', async () => {
    await bootstrapSuperAdmin({
      name: 'First Admin',
      email: 'first@hazzino.com',
      password: 'FirstPassword123!',
    });

    await expect(
      bootstrapSuperAdmin({
        name: 'Second Admin',
        email: 'second@hazzino.com',
        password: 'SecondPassword123!',
      }),
    ).rejects.toThrow(/already exists/i);

    expect(listUsers().length).toBe(1);
  });

  test('rejects invalid inputs (bad email, short password)', async () => {
    // Bad email
    await expect(
      bootstrapSuperAdmin({
        name: 'Admin',
        email: 'not-an-email',
        password: 'ValidPassword123!',
      }),
    ).rejects.toThrow(/invalid email/i);

    // Short password
    await expect(
      bootstrapSuperAdmin({
        name: 'Admin',
        email: 'admin@hazzino.com',
        password: 'short',
      }),
    ).rejects.toThrow(/at least 8/i);
  });
});

