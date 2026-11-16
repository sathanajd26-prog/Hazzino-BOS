import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { hashPassword, validatePasswordShape } from './crypto';
import { getAuthDb } from './db';
import {
  EmailAlreadyExistsError,
  InvalidRoleError,
  isUserRole,
  type CreateUserInput,
  type SafeUser,
  type UpdateUserInput,
  type UserRecord,
  type UserRole,
} from './types';

/** Map a raw database row into a SafeUser domain object (stripping password hash). */
export function toSafeUser(row: UserRecord): SafeUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    departmentId: row.department_id,
    isActive: row.is_active === 1,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    passwordChangedAt: row.password_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isDb(val: unknown): val is Database.Database {
  return typeof val === 'object' && val !== null && typeof (val as any).prepare === 'function';
}

/**
 * Create a new user account with hashed password storage.
 * Enforces valid role constraints, case-insensitive email uniqueness, and timestamping.
 */
export function createUser(input: CreateUserInput): SafeUser;
export function createUser(db: Database.Database, input: CreateUserInput): SafeUser;
export function createUser(dbOrInput: Database.Database | CreateUserInput, maybeInput?: CreateUserInput): SafeUser {
  const db = isDb(dbOrInput) ? dbOrInput : getAuthDb();
  const input = isDb(dbOrInput) ? maybeInput! : dbOrInput;

  if (!isUserRole(input.role)) {
    throw new InvalidRoleError(input.role);
  }

  const email = input.email.trim();
  if (!email || !email.includes('@')) {
    throw new Error('Valid email address is required');
  }

  const name = input.name.trim();
  if (!name) {
    throw new Error('User name cannot be empty');
  }

  let passwordHash = input.passwordHash;
  if (!passwordHash) {
    if (!input.password) {
      throw new Error('Either password or passwordHash must be provided');
    }
    const shapeErr = validatePasswordShape(input.password);
    if (shapeErr) throw new Error(shapeErr);
    passwordHash = hashPassword(input.password);
  }

  const id = input.id ?? randomUUID();
  const now = Date.now();
  const isActive = input.isActive ?? true ? 1 : 0;
  const deptId = input.departmentId?.trim() || null;

  try {
    const stmt = db.prepare(`
      INSERT INTO users (
        id, email, name, password_hash, role, department_id,
        is_active, failed_attempts, locked_until, password_changed_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
    `);

    stmt.run(id, email, name, passwordHash, input.role, deptId, isActive, now, now);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('UNIQUE constraint failed') && message.includes('users.email')) {
      throw new EmailAlreadyExistsError(email);
    }
    throw err;
  }

  const created = findUserRecordById(db, id);
  if (!created) throw new Error(`Failed to retrieve user after creation: ${id}`);
  return toSafeUser(created);
}

/** Find a raw user record by ID (internal only). */
export function findUserRecordById(id: string): UserRecord | null;
export function findUserRecordById(db: Database.Database, id: string): UserRecord | null;
export function findUserRecordById(dbOrId: Database.Database | string, maybeId?: string): UserRecord | null {
  const db = isDb(dbOrId) ? dbOrId : getAuthDb();
  const id = isDb(dbOrId) ? maybeId! : dbOrId;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord | undefined;
  return row ?? null;
}

/** Find a safe user by ID (password hash omitted). */
export function findUserById(id: string): SafeUser | null;
export function findUserById(db: Database.Database, id: string): SafeUser | null;
export function findUserById(dbOrId: Database.Database | string, maybeId?: string): SafeUser | null {
  const db = isDb(dbOrId) ? dbOrId : getAuthDb();
  const id = isDb(dbOrId) ? maybeId! : dbOrId;
  const row = findUserRecordById(db, id);
  return row ? toSafeUser(row) : null;
}

/** Find a raw user record by email (internal only, for login password verification). */
export function findUserRecordByEmail(email: string): UserRecord | null;
export function findUserRecordByEmail(db: Database.Database, email: string): UserRecord | null;
export function findUserRecordByEmail(dbOrEmail: Database.Database | string, maybeEmail?: string): UserRecord | null {
  const db = isDb(dbOrEmail) ? dbOrEmail : getAuthDb();
  const email = isDb(dbOrEmail) ? maybeEmail! : dbOrEmail;
  const trimmed = email.trim();
  const row = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(trimmed) as UserRecord | undefined;
  return row ?? null;
}

/** Find a safe user by email (password hash omitted). */
export function findUserByEmail(email: string): SafeUser | null;
export function findUserByEmail(db: Database.Database, email: string): SafeUser | null;
export function findUserByEmail(dbOrEmail: Database.Database | string, maybeEmail?: string): SafeUser | null {
  const db = isDb(dbOrEmail) ? dbOrEmail : getAuthDb();
  const email = isDb(dbOrEmail) ? maybeEmail! : dbOrEmail;
  const row = findUserRecordByEmail(db, email);
  return row ? toSafeUser(row) : null;
}

/**
 * List users matching optional role, department, or active status filters.
 * Never includes password hashes.
 */
export function listUsers(filter?: { role?: UserRole; departmentId?: string; isActive?: boolean }): SafeUser[];
export function listUsers(db: Database.Database, filter?: { role?: UserRole; departmentId?: string; isActive?: boolean }): SafeUser[];
export function listUsers(
  dbOrFilter?: Database.Database | { role?: UserRole; departmentId?: string; isActive?: boolean },
  maybeFilter?: { role?: UserRole; departmentId?: string; isActive?: boolean },
): SafeUser[] {
  const db = isDb(dbOrFilter) ? dbOrFilter : getAuthDb();
  const filter = isDb(dbOrFilter) ? maybeFilter : dbOrFilter;

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter?.role) {
    if (!isUserRole(filter.role)) throw new InvalidRoleError(filter.role);
    clauses.push('role = ?');
    params.push(filter.role);
  }

  if (filter?.departmentId !== undefined) {
    clauses.push('department_id = ?');
    params.push(filter.departmentId);
  }

  if (filter?.isActive !== undefined) {
    clauses.push('is_active = ?');
    params.push(filter.isActive ? 1 : 0);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM users ${where} ORDER BY created_at ASC`).all(...params) as UserRecord[];
  return rows.map(toSafeUser);
}

/**
 * Update user details (name, role, department).
 */
export function updateUser(id: string, input: UpdateUserInput): SafeUser | null;
export function updateUser(db: Database.Database, id: string, input: UpdateUserInput): SafeUser | null;
export function updateUser(
  dbOrId: Database.Database | string,
  idOrInput: string | UpdateUserInput,
  maybeInput?: UpdateUserInput,
): SafeUser | null {
  const db = isDb(dbOrId) ? dbOrId : getAuthDb();
  const id = isDb(dbOrId) ? (idOrInput as string) : (dbOrId as string);
  const input = isDb(dbOrId) ? maybeInput! : (idOrInput as UpdateUserInput);

  const existing = findUserRecordById(db, id);
  if (!existing) return null;

  if (input.role !== undefined && !isUserRole(input.role)) {
    throw new InvalidRoleError(input.role);
  }

  const name = input.name !== undefined ? input.name.trim() : existing.name;
  if (!name) throw new Error('User name cannot be empty');

  const role = input.role ?? existing.role;
  const deptId = input.departmentId !== undefined ? input.departmentId?.trim() || null : existing.department_id;
  const now = Date.now();

  db.prepare(`
    UPDATE users
    SET name = ?, role = ?, department_id = ?, updated_at = ?
    WHERE id = ?
  `).run(name, role, deptId, now, id);

  const updated = findUserRecordById(db, id);
  return updated ? toSafeUser(updated) : null;
}

/**
 * Activate or deactivate a user account.
 */
export function setUserActive(id: string, isActive: boolean): SafeUser | null;
export function setUserActive(db: Database.Database, id: string, isActive: boolean): SafeUser | null;
export function setUserActive(
  dbOrId: Database.Database | string,
  idOrActive: string | boolean,
  maybeActive?: boolean,
): SafeUser | null {
  const db = isDb(dbOrId) ? dbOrId : getAuthDb();
  const id = isDb(dbOrId) ? (idOrActive as string) : (dbOrId as string);
  const isActive = isDb(dbOrId) ? maybeActive! : (idOrActive as boolean);

  const now = Date.now();
  const res = db.prepare(`
    UPDATE users
    SET is_active = ?, updated_at = ?
    WHERE id = ?
  `).run(isActive ? 1 : 0, now, id);

  if (res.changes === 0) return null;
  return findUserById(db, id);
}

/**
 * Update a user's password hash and record the change timestamp.
 */
export function updatePasswordHash(id: string, newPasswordHash: string): boolean;
export function updatePasswordHash(db: Database.Database, id: string, newPasswordHash: string): boolean;
export function updatePasswordHash(
  dbOrId: Database.Database | string,
  idOrHash: string,
  maybeHash?: string,
): boolean {
  const db = isDb(dbOrId) ? dbOrId : getAuthDb();
  const id = isDb(dbOrId) ? idOrHash : (dbOrId as string);
  const newPasswordHash = isDb(dbOrId) ? maybeHash! : idOrHash;

  const now = Date.now();
  const res = db.prepare(`
    UPDATE users
    SET password_hash = ?, password_changed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(newPasswordHash, now, now, id);

  return res.changes > 0;
}

/** Maximum failed attempts before account is temporarily locked. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/**
 * Increment failed login attempts. Locks account if threshold is met.
 */
export function recordFailedLogin(id: string, lockDurationSeconds?: number): { failedAttempts: number; lockedUntil: number | null };
export function recordFailedLogin(db: Database.Database, id: string, lockDurationSeconds?: number): { failedAttempts: number; lockedUntil: number | null };
export function recordFailedLogin(
  dbOrId: Database.Database | string,
  idOrDuration?: string | number,
  maybeDuration = 900,
): { failedAttempts: number; lockedUntil: number | null } {
  const db = isDb(dbOrId) ? dbOrId : getAuthDb();
  const id = isDb(dbOrId) ? (idOrDuration as string) : (dbOrId as string);
  const lockDurationSeconds = isDb(dbOrId) ? maybeDuration : ((idOrDuration as number) ?? 900);

  const run = db.transaction(() => {
    const user = db.prepare('SELECT failed_attempts FROM users WHERE id = ?').get(id) as { failed_attempts: number } | undefined;
    if (!user) return { failedAttempts: 0, lockedUntil: null };

    const attempts = user.failed_attempts + 1;
    const now = Date.now();
    const lockedUntil = attempts >= MAX_FAILED_LOGIN_ATTEMPTS ? now + lockDurationSeconds * 1000 : null;

    db.prepare(`
      UPDATE users
      SET failed_attempts = ?, locked_until = ?, updated_at = ?
      WHERE id = ?
    `).run(attempts, lockedUntil, now, id);

    return { failedAttempts: attempts, lockedUntil };
  });

  return run.immediate();
}

/**
 * Reset failed login attempts and unlock the user account.
 */
export function resetFailedLogins(id: string): void;
export function resetFailedLogins(db: Database.Database, id: string): void;
export function resetFailedLogins(dbOrId: Database.Database | string, maybeId?: string): void {
  const db = isDb(dbOrId) ? dbOrId : getAuthDb();
  const id = isDb(dbOrId) ? maybeId! : (dbOrId as string);
  const now = Date.now();
  db.prepare(`
    UPDATE users
    SET failed_attempts = 0, locked_until = NULL, updated_at = ?
    WHERE id = ?
  `).run(now, id);
}

/**
 * Lock an account until a specific timestamp.
 */
export function lockUserUntil(id: string, untilTimestampMs: number): void;
export function lockUserUntil(db: Database.Database, id: string, untilTimestampMs: number): void;
export function lockUserUntil(dbOrId: Database.Database | string, idOrTimestamp: string | number, maybeTimestamp?: number): void {
  const db = isDb(dbOrId) ? dbOrId : getAuthDb();
  const id = isDb(dbOrId) ? (idOrTimestamp as string) : (dbOrId as string);
  const untilTimestampMs = isDb(dbOrId) ? maybeTimestamp! : (idOrTimestamp as number);

  const now = Date.now();
  db.prepare(`
    UPDATE users
    SET locked_until = ?, updated_at = ?
    WHERE id = ?
  `).run(untilTimestampMs, now, id);
}

/**
 * Delete a user by ID. Cascades to delete all sessions belonging to the user.
 */
export function deleteUser(id: string): boolean;
export function deleteUser(db: Database.Database, id: string): boolean;
export function deleteUser(dbOrId: Database.Database | string, maybeId?: string): boolean {
  const db = isDb(dbOrId) ? dbOrId : getAuthDb();
  const id = isDb(dbOrId) ? maybeId! : (dbOrId as string);
  const res = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return res.changes > 0;
}
