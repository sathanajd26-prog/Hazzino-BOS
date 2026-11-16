import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const AUTH_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('super_admin', 'admin', 'manager', 'employee', 'viewer')),
  department_id TEXT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NULL,
  password_changed_at INTEGER NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  ip_address TEXT NULL,
  user_agent TEXT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
`;

/**
 * Resolve the persistent location of the authentication database.
 *
 * CRITICAL ISOLATION GUARANTEE:
 * This always resolves to `data/auth.db` (or HAZZINO_AUTH_DB for isolated test suites).
 * It is completely independent of `dataDir()`, `DEMO_MODE`, and `.glados-mode`.
 * It is never created inside or redirected to `demo-data/`, preventing accounts
 * from being deleted or partitioned during demo store builds or Sandbox mode toggling.
 */
export function resolveAuthDbPath(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.HAZZINO_AUTH_DB?.trim();
  if (explicit) return explicit;
  return path.join(process.cwd(), 'data', 'auth.db');
}

/**
 * Initialize the authentication schema idempotently and enable WAL mode & foreign keys.
 */
export function initAuthDb(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const setup = db.transaction(() => {
    db.exec(AUTH_DDL);
  });
  setup.immediate();
}

/**
 * Open an authentication database instance at the given path (or default permanent path).
 */
export function openAuthDb(customPath?: string): Database.Database {
  const dbPath = customPath ?? resolveAuthDbPath();
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  initAuthDb(db);
  return db;
}

let authInstance: Database.Database | null = null;

/**
 * Get or initialize the application-wide singleton authentication database connection.
 */
export function getAuthDb(): Database.Database {
  if (authInstance && authInstance.open) return authInstance;
  authInstance = openAuthDb();
  return authInstance;
}

/**
 * Close and reset the singleton connection (primarily for testing and process teardown).
 */
export function closeAuthDb(): void {
  if (authInstance && authInstance.open) {
    try {
      authInstance.close();
    } catch {
      // ignore close errors on shutdown
    }
  }
  authInstance = null;
}

