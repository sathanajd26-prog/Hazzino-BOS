import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AUTH_DDL, initAuthDb, openAuthDb, resolveAuthDbPath } from '@/lib/auth/db';
import {
  createUser,
  deleteUser,
  findUserByEmail,
  findUserById,
  findUserRecordByEmail,
  findUserRecordById,
  listUsers,
  lockUserUntil,
  recordFailedLogin,
  resetFailedLogins,
  setUserActive,
  updatePasswordHash,
  updateUser,
} from '@/lib/auth/users';
import {
  cleanExpiredSessions,
  createSession,
  deleteSession,
  deleteSessionByToken,
  findSessionByToken,
  listActiveSessionsForUser,
  revokeAllUserSessions,
} from '@/lib/auth/sessions';
import { recordAuditLog, listAuditLogs } from '@/lib/auth/audit';
import { EmailAlreadyExistsError, InvalidRoleError, type UserRole } from '@/lib/auth/types';
import { hashPassword, hashSessionToken, verifyPassword } from '@/lib/auth/crypto';

describe('Phase 5D-1: Authentication Foundation', () => {
  let tmpDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hazzino-auth-test-'));
    dbPath = path.join(tmpDir, 'auth-test.db');
    db = openAuthDb(dbPath);
  });

  afterEach(() => {
    if (db.open) db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.HAZZINO_AUTH_DB;
    delete process.env.DEMO_MODE;
    delete process.env.GLADOS_DEFAULT_MODE;
  });

  // 1. Authentication database initializes successfully
  test('1. authentication database initializes successfully', () => {
    expect(db.open).toBe(true);
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    ).map((t) => t.name);

    expect(tables).toContain('users');
    expect(tables).toContain('sessions');
    expect(tables).toContain('audit_logs');
  });

  // 2. Repeated initialization does not duplicate schema (idempotent)
  test('2. repeated initialization is idempotent', () => {
    expect(() => initAuthDb(db)).not.toThrow();
    expect(() => initAuthDb(db)).not.toThrow();

    const count = db
      .prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name IN ('users', 'sessions', 'audit_logs')")
      .get() as { cnt: number };
    expect(count.cnt).toBe(3);
  });

  // 3. Authentication database path remains unchanged when Sandbox / Demo Mode changes
  test('3. authentication database path remains unchanged when Sandbox / Demo Mode changes', async () => {
    const { filmingMode, invalidateModeCache } = await import('@/lib/paths');

    delete process.env.HAZZINO_AUTH_DB;
    delete process.env.DEMO_MODE;
    invalidateModeCache();

    // Verify baseline path
    const realAuthPath = resolveAuthDbPath();
    expect(realAuthPath).toBe(path.join(process.cwd(), 'data', 'auth.db'));

    // Flip to Demo Mode
    process.env.DEMO_MODE = '1';
    invalidateModeCache();
    expect(filmingMode()).toBe(true);

    // Path must STILL resolve to data/auth.db, completely unaffected by Demo Mode
    const demoAuthPath = resolveAuthDbPath();
    expect(demoAuthPath).toBe(path.join(process.cwd(), 'data', 'auth.db'));
    expect(demoAuthPath).toBe(realAuthPath);

    // Flip back to Real Mode
    process.env.DEMO_MODE = '0';
    invalidateModeCache();
    expect(filmingMode()).toBe(false);
    expect(resolveAuthDbPath()).toBe(realAuthPath);
  });

  // 4. Authentication database is never located in demo-data/
  test('4. authentication database is never located in demo-data/', () => {
    delete process.env.HAZZINO_AUTH_DB;
    const resolved = resolveAuthDbPath();
    expect(resolved).not.toContain('demo-data');
    expect(resolved.endsWith(path.join('data', 'auth.db'))).toBe(true);
  });

  // 5. Foreign key enforcement is enabled
  test('5. foreign key enforcement is enabled', () => {
    const fkStatus = db.pragma('foreign_keys', { simple: true });
    expect(fkStatus).toBe(1);

    // Inserting a session with an invalid user_id must throw foreign key constraint violation
    expect(() => {
      db.prepare(`
        INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_active_at)
        VALUES ('s1', 'nonexistent-user', 'hash123', 9999999999999, 1000, 1000)
      `).run();
    }).toThrow(/FOREIGN KEY/i);
  });

  // 6. Valid user creation works
  test('6. valid user creation works', () => {
    const user = createUser(db, {
      email: 'alex@hazzino.com',
      name: 'Alex Mercer',
      password: 'SecurePassword123!',
      role: 'admin',
      departmentId: 'dept-eng',
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe('alex@hazzino.com');
    expect(user.name).toBe('Alex Mercer');
    expect(user.role).toBe('admin');
    expect(user.departmentId).toBe('dept-eng');
    expect(user.isActive).toBe(true);
    expect(user.failedAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
    expect(user.createdAt).toBeGreaterThan(0);
    expect(user.updatedAt).toBeGreaterThan(0);
  });

  // 7. Duplicate email is rejected safely, including case-insensitive duplicates
  test('7. duplicate email is rejected safely, including case-insensitive duplicates', () => {
    createUser(db, {
      email: 'sara@hazzino.com',
      name: 'Sara Connor',
      password: 'SecurePassword123!',
      role: 'manager',
    });

    // Exact duplicate
    expect(() => {
      createUser(db, {
        email: 'sara@hazzino.com',
        name: 'Sara Duplicate',
        password: 'AnotherPassword123!',
        role: 'employee',
      });
    }).toThrow(EmailAlreadyExistsError);

    // Case-insensitive duplicate (e.g. uppercase)
    expect(() => {
      createUser(db, {
        email: 'SARA@HAZZINO.COM',
        name: 'Sara Upper',
        password: 'AnotherPassword123!',
        role: 'employee',
      });
    }).toThrow(EmailAlreadyExistsError);
  });

  // 8. User lookup by ID and email works
  test('8. user lookup by ID and email works', () => {
    const created = createUser(db, {
      email: 'elena@hazzino.com',
      name: 'Elena Rostova',
      password: 'Password999!',
      role: 'super_admin',
    });

    const byId = findUserById(db, created.id);
    expect(byId).toEqual(created);

    const byEmailExact = findUserByEmail(db, 'elena@hazzino.com');
    expect(byEmailExact).toEqual(created);

    const byEmailCaseInsensitive = findUserByEmail(db, 'ELENA@HAZZINO.COM');
    expect(byEmailCaseInsensitive).toEqual(created);

    expect(findUserById(db, 'unknown-id')).toBeNull();
    expect(findUserByEmail(db, 'nobody@hazzino.com')).toBeNull();
  });

  // 9. Public user results never contain password hashes
  test('9. public user results never contain password hashes', () => {
    const user = createUser(db, {
      email: 'dev@hazzino.com',
      name: 'Dev Tester',
      password: 'SecretPassword123!',
      role: 'employee',
    });

    expect('password_hash' in user).toBe(false);
    expect('passwordHash' in user).toBe(false);

    const fromList = listUsers(db);
    expect(fromList.length).toBeGreaterThan(0);
    for (const u of fromList) {
      expect('password_hash' in u).toBe(false);
      expect('passwordHash' in u).toBe(false);
    }

    // Only internal raw lookup holds the hash
    const raw = findUserRecordById(db, user.id);
    expect(raw?.password_hash).toMatch(/^scrypt:/);
  });

  // 10. Invalid roles are rejected
  test('10. invalid roles are rejected', () => {
    expect(() => {
      createUser(db, {
        email: 'hacker@hazzino.com',
        name: 'Hacker',
        password: 'Password123!',
        role: 'root' as unknown as UserRole,
      });
    }).toThrow(InvalidRoleError);

    expect(() => {
      createUser(db, {
        email: 'owner@hazzino.com',
        name: 'Owner',
        password: 'Password123!',
        role: 'superuser' as unknown as UserRole,
      });
    }).toThrow(InvalidRoleError);
  });

  // 11. User activation and deactivation work
  test('11. user activation and deactivation work', () => {
    const user = createUser(db, {
      email: 'staff@hazzino.com',
      name: 'Staff Member',
      password: 'Password123!',
      role: 'employee',
    });
    expect(user.isActive).toBe(true);

    const deactivated = setUserActive(db, user.id, false);
    expect(deactivated?.isActive).toBe(false);

    const reActivated = setUserActive(db, user.id, true);
    expect(reActivated?.isActive).toBe(true);
  });

  // 12. Password hash updates work
  test('12. password hash updates work', () => {
    const user = createUser(db, {
      email: 'auth-change@hazzino.com',
      name: 'Auth Change',
      password: 'OldPassword123!',
      role: 'manager',
    });

    const rawBefore = findUserRecordById(db, user.id)!;
    expect(verifyPassword('OldPassword123!', rawBefore.password_hash)).toBe(true);

    const newHash = hashPassword('NewSuperPassword456!');
    const updated = updatePasswordHash(db, user.id, newHash);
    expect(updated).toBe(true);

    const rawAfter = findUserRecordById(db, user.id)!;
    expect(verifyPassword('OldPassword123!', rawAfter.password_hash)).toBe(false);
    expect(verifyPassword('NewSuperPassword456!', rawAfter.password_hash)).toBe(true);
    expect(rawAfter.password_changed_at).toBeGreaterThan(0);
  });

  // 13. Session tokens are generated securely
  // 14. Only token hashes are persisted
  test('13 & 14. session tokens are generated securely and only hashes are persisted', () => {
    const user = createUser(db, {
      email: 'session-user@hazzino.com',
      name: 'Session User',
      password: 'Password123!',
      role: 'employee',
    });

    const { session, rawToken } = createSession(db, {
      userId: user.id,
      ipAddress: '192.168.1.100',
      userAgent: 'Mozilla/5.0 TestBrowser',
    });

    expect(rawToken).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex
    expect(session.userId).toBe(user.id);
    expect(session.tokenHash).toBe(hashSessionToken(rawToken));

    // Inspect database row directly: rawToken must NEVER appear in DB
    const dbRow = db.prepare('SELECT * FROM sessions WHERE id = ?').get(session.id) as {
      token_hash: string;
      [key: string]: unknown;
    };
    expect(dbRow.token_hash).toBe(session.tokenHash);
    expect(JSON.stringify(dbRow)).not.toContain(rawToken);
  });

  // 15. Session lookup using the raw token works
  test('15. session lookup using the raw token works', () => {
    const user = createUser(db, {
      email: 'lookup@hazzino.com',
      name: 'Lookup User',
      password: 'Password123!',
      role: 'viewer',
    });

    const { session, rawToken } = createSession(db, { userId: user.id });

    const result = findSessionByToken(db, rawToken);
    expect(result).not.toBeNull();
    expect(result?.session.id).toBe(session.id);
    expect(result?.user.id).toBe(user.id);
    expect(result?.user.email).toBe('lookup@hazzino.com');
  });

  // 16. Invalid and expired sessions are rejected by the repository
  test('16. invalid and expired sessions are rejected by the repository', () => {
    const user = createUser(db, {
      email: 'expired-test@hazzino.com',
      name: 'Expired Test',
      password: 'Password123!',
      role: 'employee',
    });

    // Non-existent token
    expect(findSessionByToken(db, 'fake-token-that-does-not-exist')).toBeNull();

    // Expired session (ttl = -1 second)
    const { rawToken } = createSession(db, { userId: user.id, ttlSeconds: -1 });
    expect(findSessionByToken(db, rawToken)).toBeNull();

    // Inactive user session
    const { rawToken: validToken } = createSession(db, { userId: user.id });
    setUserActive(db, user.id, false);
    expect(findSessionByToken(db, validToken)).toBeNull();

    // Locked user session
    setUserActive(db, user.id, true);
    lockUserUntil(db, user.id, Date.now() + 60_000);
    expect(findSessionByToken(db, validToken)).toBeNull();
  });

  // 17. Individual session deletion works
  test('17. individual session deletion works', () => {
    const user = createUser(db, {
      email: 'del-session@hazzino.com',
      name: 'Delete Session User',
      password: 'Password123!',
      role: 'employee',
    });

    const { session, rawToken } = createSession(db, { userId: user.id });
    expect(findSessionByToken(db, rawToken)).not.toBeNull();

    const deleted = deleteSession(db, session.id);
    expect(deleted).toBe(true);
    expect(findSessionByToken(db, rawToken)).toBeNull();

    // Delete by token
    const { rawToken: rawToken2 } = createSession(db, { userId: user.id });
    expect(deleteSessionByToken(db, rawToken2)).toBe(true);
    expect(findSessionByToken(db, rawToken2)).toBeNull();
  });

  // 18. All sessions for a user can be revoked
  test('18. all sessions for a user can be revoked', () => {
    const user = createUser(db, {
      email: 'multi-session@hazzino.com',
      name: 'Multi Session User',
      password: 'Password123!',
      role: 'manager',
    });

    const s1 = createSession(db, { userId: user.id });
    const s2 = createSession(db, { userId: user.id });
    const s3 = createSession(db, { userId: user.id });

    expect(listActiveSessionsForUser(db, user.id)).toHaveLength(3);

    const revokedCount = revokeAllUserSessions(db, user.id);
    expect(revokedCount).toBe(3);

    expect(findSessionByToken(db, s1.rawToken)).toBeNull();
    expect(findSessionByToken(db, s2.rawToken)).toBeNull();
    expect(findSessionByToken(db, s3.rawToken)).toBeNull();
    expect(listActiveSessionsForUser(db, user.id)).toHaveLength(0);
  });

  // 19. Expired session cleanup works
  test('19. expired session cleanup works', () => {
    const user = createUser(db, {
      email: 'cleanup@hazzino.com',
      name: 'Cleanup User',
      password: 'Password123!',
      role: 'employee',
    });

    // Create 2 expired sessions and 1 active session
    createSession(db, { userId: user.id, ttlSeconds: -10 });
    createSession(db, { userId: user.id, ttlSeconds: -5 });
    createSession(db, { userId: user.id, ttlSeconds: 3600 });

    const totalBefore = (db.prepare('SELECT count(*) as cnt FROM sessions').get() as { cnt: number }).cnt;
    expect(totalBefore).toBe(3);

    const cleaned = cleanExpiredSessions(db);
    expect(cleaned).toBe(2);

    const totalAfter = (db.prepare('SELECT count(*) as cnt FROM sessions').get() as { cnt: number }).cnt;
    expect(totalAfter).toBe(1);
  });

  // 20. User deletion cascades to sessions
  test('20. user deletion cascades to sessions', () => {
    const user = createUser(db, {
      email: 'cascade@hazzino.com',
      name: 'Cascade User',
      password: 'Password123!',
      role: 'employee',
    });

    const s1 = createSession(db, { userId: user.id });
    const s2 = createSession(db, { userId: user.id });

    const sessionsBefore = (
      db.prepare('SELECT count(*) as cnt FROM sessions WHERE user_id = ?').get(user.id) as { cnt: number }
    ).cnt;
    expect(sessionsBefore).toBe(2);

    // Delete user
    const deleted = deleteUser(db, user.id);
    expect(deleted).toBe(true);

    // Sessions must be cascade deleted by SQLite
    const sessionsAfter = (
      db.prepare('SELECT count(*) as cnt FROM sessions WHERE user_id = ?').get(user.id) as { cnt: number }
    ).cnt;
    expect(sessionsAfter).toBe(0);
    expect(findSessionByToken(db, s1.rawToken)).toBeNull();
    expect(findSessionByToken(db, s2.rawToken)).toBeNull();
  });

  // 21. Audit log user references use the intended deletion behavior (ON DELETE SET NULL)
  test('21. audit log user references use ON DELETE SET NULL', () => {
    const user = createUser(db, {
      email: 'auditor@hazzino.com',
      name: 'Auditor User',
      password: 'Password123!',
      role: 'admin',
    });

    const log = recordAuditLog(db, {
      userId: user.id,
      action: 'UPDATE_SETTINGS',
      resource: 'security_config',
      details: { field: 'mfa', enabled: true },
      ipAddress: '10.0.0.1',
    });

    expect(log.id).toBeDefined();
    expect(log.user_id).toBe(user.id);
    expect(log.action).toBe('UPDATE_SETTINGS');
    expect(JSON.parse(log.details_json)).toEqual({ field: 'mfa', enabled: true });

    // Delete the user
    deleteUser(db, user.id);

    // Audit log MUST persist with user_id set to NULL (ON DELETE SET NULL)
    const logAfter = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(log.id) as {
      user_id: string | null;
      action: string;
    };
    expect(logAfter).toBeDefined();
    expect(logAfter.user_id).toBeNull();
    expect(logAfter.action).toBe('UPDATE_SETTINGS');
  });

  // Account locking & failed attempts helpers
  test('failed login attempts trigger automatic account locking at threshold', () => {
    const user = createUser(db, {
      email: 'throttled@hazzino.com',
      name: 'Throttled User',
      password: 'Password123!',
      role: 'employee',
    });

    expect(user.failedAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();

    // 1 to 4 failed attempts: not locked
    for (let i = 1; i <= 4; i++) {
      const res = recordFailedLogin(db, user.id);
      expect(res.failedAttempts).toBe(i);
      expect(res.lockedUntil).toBeNull();
    }

    // 5th attempt: locked for 900 seconds (15 mins)
    const lockedRes = recordFailedLogin(db, user.id, 900);
    expect(lockedRes.failedAttempts).toBe(5);
    expect(lockedRes.lockedUntil).toBeGreaterThan(Date.now());

    // Reset failed logins unlocks the user
    resetFailedLogins(db, user.id);
    const refreshed = findUserById(db, user.id)!;
    expect(refreshed.failedAttempts).toBe(0);
    expect(refreshed.lockedUntil).toBeNull();
  });
});

