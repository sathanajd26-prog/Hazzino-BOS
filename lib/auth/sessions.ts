import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { generateSessionToken, hashSessionToken } from './crypto';
import { toSafeUser } from './users';
import { getAuthDb } from './db';
import type { CreateSessionInput, SafeUser, Session, SessionRecord, UserRecord } from './types';

export const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function isDb(val: unknown): val is Database.Database {
  return typeof val === 'object' && val !== null && typeof (val as any).prepare === 'function';
}

/** Map a raw database session row into a domain Session object. */
export function toSession(row: SessionRecord): Session {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}

/**
 * Create a new user session with a cryptographically secure 32-byte token.
 * Only the SHA-256 hash of the token is saved in the database; the raw token is returned once.
 */
export function createSession(input: CreateSessionInput): { session: Session; rawToken: string };
export function createSession(db: Database.Database, input: CreateSessionInput): { session: Session; rawToken: string };
export function createSession(
  dbOrInput: Database.Database | CreateSessionInput,
  maybeInput?: CreateSessionInput,
): { session: Session; rawToken: string } {
  const db = isDb(dbOrInput) ? dbOrInput : getAuthDb();
  const input = isDb(dbOrInput) ? maybeInput! : dbOrInput;

  const { rawToken, tokenHash } = generateSessionToken();
  const id = randomUUID();
  const now = Date.now();
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const expiresAt = now + ttlSeconds * 1000;
  const ipAddress = input.ipAddress?.trim() || null;
  const userAgent = input.userAgent?.trim() || null;

  db.prepare(`
    INSERT INTO sessions (
      id, user_id, token_hash, expires_at, created_at, last_active_at, ip_address, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.userId, tokenHash, expiresAt, now, now, ipAddress, userAgent);

  const created = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRecord | undefined;
  if (!created) throw new Error(`Failed to retrieve session after creation: ${id}`);

  return {
    session: toSession(created),
    rawToken,
  };
}

/**
 * Validate a supplied raw session token by computing its SHA-256 digest and querying the database.
 * Rejects expired sessions, non-existent sessions, and sessions belonging to inactive or locked users.
 * Automatically updates `last_active_at` on successful validation.
 */
export function findSessionByToken(rawToken: string): { session: Session; user: SafeUser } | null;
export function findSessionByToken(db: Database.Database, rawToken: string): { session: Session; user: SafeUser } | null;
export function findSessionByToken(
  dbOrToken: Database.Database | string,
  maybeToken?: string,
): { session: Session; user: SafeUser } | null {
  const db = isDb(dbOrToken) ? dbOrToken : getAuthDb();
  const rawToken = isDb(dbOrToken) ? maybeToken! : dbOrToken;

  if (!rawToken || typeof rawToken !== 'string') return null;

  const tokenHash = hashSessionToken(rawToken);
  const now = Date.now();

  const row = db
    .prepare(`
      SELECT 
        s.id AS s_id, s.user_id AS s_user_id, s.token_hash AS s_token_hash,
        s.expires_at AS s_expires_at, s.created_at AS s_created_at,
        s.last_active_at AS s_last_active_at, s.ip_address AS s_ip_address,
        s.user_agent AS s_user_agent,
        u.id AS u_id, u.email AS u_email, u.name AS u_name,
        u.password_hash AS u_password_hash, u.role AS u_role,
        u.department_id AS u_department_id, u.is_active AS u_is_active,
        u.failed_attempts AS u_failed_attempts, u.locked_until AS u_locked_until,
        u.password_changed_at AS u_password_changed_at,
        u.created_at AS u_created_at, u.updated_at AS u_updated_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ?
    `)
    .get(tokenHash) as
    | {
        s_id: string;
        s_user_id: string;
        s_token_hash: string;
        s_expires_at: number;
        s_created_at: number;
        s_last_active_at: number;
        s_ip_address: string | null;
        s_user_agent: string | null;
        u_id: string;
        u_email: string;
        u_name: string;
        u_password_hash: string;
        u_role: string;
        u_department_id: string | null;
        u_is_active: number;
        u_failed_attempts: number;
        u_locked_until: number | null;
        u_password_changed_at: number | null;
        u_created_at: number;
        u_updated_at: number;
      }
    | undefined;

  if (!row) return null;

  // Session expiry check
  if (row.s_expires_at <= now) {
    return null;
  }

  // User status check (must be active and not locked)
  if (row.u_is_active !== 1) {
    return null;
  }

  if (row.u_locked_until && row.u_locked_until > now) {
    return null;
  }

  // Update last_active_at
  db.prepare('UPDATE sessions SET last_active_at = ? WHERE id = ?').run(now, row.s_id);

  const session: Session = {
    id: row.s_id,
    userId: row.s_user_id,
    tokenHash: row.s_token_hash,
    expiresAt: row.s_expires_at,
    createdAt: row.s_created_at,
    lastActiveAt: now,
    ipAddress: row.s_ip_address,
    userAgent: row.s_user_agent,
  };

  const userRecord: UserRecord = {
    id: row.u_id,
    email: row.u_email,
    name: row.u_name,
    password_hash: row.u_password_hash,
    role: row.u_role as SafeUser['role'],
    department_id: row.u_department_id,
    is_active: row.u_is_active,
    failed_attempts: row.u_failed_attempts,
    locked_until: row.u_locked_until,
    password_changed_at: row.u_password_changed_at,
    created_at: row.u_created_at,
    updated_at: row.u_updated_at,
  };

  return { session, user: toSafeUser(userRecord) };
}

/**
 * List all active, non-expired sessions for a specific user.
 */
export function listActiveSessionsForUser(userId: string): Session[];
export function listActiveSessionsForUser(db: Database.Database, userId: string): Session[];
export function listActiveSessionsForUser(dbOrUserId: Database.Database | string, maybeUserId?: string): Session[] {
  const db = isDb(dbOrUserId) ? dbOrUserId : getAuthDb();
  const userId = isDb(dbOrUserId) ? maybeUserId! : dbOrUserId;

  const now = Date.now();
  const rows = db
    .prepare('SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_active_at DESC')
    .all(userId, now) as SessionRecord[];

  return rows.map(toSession);
}

/**
 * Delete a session by ID.
 */
export function deleteSession(sessionId: string): boolean;
export function deleteSession(db: Database.Database, sessionId: string): boolean;
export function deleteSession(dbOrId: Database.Database | string, maybeId?: string): boolean {
  const db = isDb(dbOrId) ? dbOrId : getAuthDb();
  const sessionId = isDb(dbOrId) ? maybeId! : dbOrId;
  const res = db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  return res.changes > 0;
}

/**
 * Delete a session by its raw token (for logout flows).
 */
export function deleteSessionByToken(rawToken: string): boolean;
export function deleteSessionByToken(db: Database.Database, rawToken: string): boolean;
export function deleteSessionByToken(dbOrToken: Database.Database | string, maybeToken?: string): boolean {
  const db = isDb(dbOrToken) ? dbOrToken : getAuthDb();
  const rawToken = isDb(dbOrToken) ? maybeToken! : dbOrToken;
  const tokenHash = hashSessionToken(rawToken);
  const res = db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  return res.changes > 0;
}

/**
 * Revoke all active sessions belonging to a specific user (e.g. on password change or security lock).
 */
export function revokeAllUserSessions(userId: string): number;
export function revokeAllUserSessions(db: Database.Database, userId: string): number;
export function revokeAllUserSessions(dbOrUserId: Database.Database | string, maybeUserId?: string): number {
  const db = isDb(dbOrUserId) ? dbOrUserId : getAuthDb();
  const userId = isDb(dbOrUserId) ? maybeUserId! : dbOrUserId;
  const res = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return res.changes;
}

/**
 * Delete all expired sessions from the database. Returns count of deleted rows.
 */
export function cleanExpiredSessions(nowMs?: number): number;
export function cleanExpiredSessions(db: Database.Database, nowMs?: number): number;
export function cleanExpiredSessions(dbOrNow?: Database.Database | number, maybeNow?: number): number {
  const db = isDb(dbOrNow) ? dbOrNow : getAuthDb();
  const nowMs = isDb(dbOrNow) ? (maybeNow ?? Date.now()) : ((dbOrNow as number) ?? Date.now());
  const res = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowMs);
  return res.changes;
}
