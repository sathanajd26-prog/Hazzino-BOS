import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { resolveAuthDbPath } from '@/lib/auth/db';
import { getDb } from '@/lib/data';
import { getAuthDb } from '@/lib/auth/db';

export type BackupResult = {
  success: boolean;
  sourcePath?: string;
  backupPath: string;
  bytes: number;
  timestamp: number;
  tableCount: number;
  tables: string[];
};

export type IntegrityCheckResult = {
  valid: boolean;
  errors?: string[];
  tableCount: number;
  tables: string[];
};

export type RestoreResult = {
  success: boolean;
  backupPath: string;
  targetPath: string;
  bytesRestored: number;
  error?: string;
};

/**
 * Known default production database basenames.
 * Any attempt to restore into these paths without explicit confirmation is blocked.
 */
const PRODUCTION_DB_FILENAMES = new Set(['glados.db', 'auth.db', 'ledger.db', 'bank.db']);

/**
 * Checks whether a target file path resolves to a production database file.
 */
export function isProductionDatabasePath(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const baseName = path.basename(resolved).toLowerCase();

  if (PRODUCTION_DB_FILENAMES.has(baseName)) {
    // If it's located under the project data directory or root data, it's considered production
    const projectData = path.resolve(process.cwd(), 'data');
    if (resolved.startsWith(projectData)) {
      return true;
    }
  }

  // Also check against resolved environment paths if present
  const authDb = path.resolve(resolveAuthDbPath());
  if (resolved === authDb && !process.env.HAZZINO_AUTH_DB) {
    return true;
  }

  return false;
}

/**
 * Inspects all non-internal user tables and their row counts in a database.
 */
export function inspectDatabaseTables(dbOrPath: Database.Database | string): { table: string; count: number }[] {
  let db: Database.Database;
  let shouldClose = false;

  if (typeof dbOrPath === 'string') {
    db = new Database(dbOrPath, { readonly: true, fileMustExist: true });
    shouldClose = true;
  } else {
    db = dbOrPath;
  }

  try {
    const tableRows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
      )
      .all() as { name: string }[];

    return tableRows.map((r) => {
      try {
        const countRow = db.prepare(`SELECT count(*) as count FROM "${r.name}"`).get() as { count: number };
        return { table: r.name, count: countRow?.count ?? 0 };
      } catch {
        return { table: r.name, count: 0 };
      }
    });
  } finally {
    if (shouldClose) {
      db.close();
    }
  }
}

/**
 * Verifies the integrity of a SQLite backup file using SQLite PRAGMA checks.
 */
export function verifyBackupIntegrity(backupPath: string): IntegrityCheckResult {
  if (!fs.existsSync(backupPath)) {
    return { valid: false, errors: [`File does not exist: ${backupPath}`], tableCount: 0, tables: [] };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(backupPath, { readonly: true, fileMustExist: true });

    // Run standard and quick integrity checks
    const integrityRows = db.pragma('integrity_check') as { integrity_check?: string }[] | string[];
    const quickRows = db.pragma('quick_check') as { quick_check?: string }[] | string[];

    const extractMsg = (row: any) => (typeof row === 'string' ? row : row?.integrity_check ?? row?.quick_check ?? '');
    const errors: string[] = [];

    for (const r of [...integrityRows, ...quickRows]) {
      const msg = extractMsg(r);
      if (msg && msg.toLowerCase() !== 'ok') {
        errors.push(msg);
      }
    }

    const tables = inspectDatabaseTables(db);

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      tableCount: tables.length,
      tables: tables.map((t) => t.table),
    };
  } catch (err: any) {
    return {
      valid: false,
      errors: [err?.message || 'Failed to open database file for integrity verification'],
      tableCount: 0,
      tables: [],
    };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Creates an online hot backup of a SQLite database to a destination path.
 * Guarantees transactional consistency even while other operations are running.
 */
export async function createDatabaseBackup(
  source: Database.Database | string,
  destinationPath: string,
): Promise<BackupResult> {
  const destDir = path.dirname(path.resolve(destinationPath));
  fs.mkdirSync(destDir, { recursive: true });

  let db: Database.Database;
  let shouldClose = false;
  let sourcePath: string | undefined;

  if (typeof source === 'string') {
    sourcePath = path.resolve(source);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source database does not exist: ${sourcePath}`);
    }
    db = new Database(sourcePath, { readonly: true, fileMustExist: true });
    shouldClose = true;
  } else {
    db = source;
  }

  try {
    // Perform live atomic backup using better-sqlite3's online backup API
    await db.backup(destinationPath);

    // Verify backup integrity immediately
    const check = verifyBackupIntegrity(destinationPath);
    if (!check.valid) {
      try {
        fs.unlinkSync(destinationPath);
      } catch {
        // ignore
      }
      throw new Error(`Backup created at ${destinationPath} failed integrity verification: ${check.errors?.join('; ')}`);
    }

    const stat = fs.statSync(destinationPath);

    return {
      success: true,
      sourcePath,
      backupPath: destinationPath,
      bytes: stat.size,
      timestamp: Date.now(),
      tableCount: check.tableCount,
      tables: check.tables,
    };
  } finally {
    if (shouldClose) {
      db.close();
    }
  }
}

/**
 * Restores a SQLite database from a verified backup file into a target location.
 * Implements strict safeguards to prevent accidental overwriting of live production databases.
 */
export function restoreDatabaseFromBackup(
  backupPath: string,
  targetPath: string,
  options: { allowProductionOverwrite?: boolean } = {},
): RestoreResult {
  const resolvedBackup = path.resolve(backupPath);
  const resolvedTarget = path.resolve(targetPath);

  if (!fs.existsSync(resolvedBackup)) {
    return {
      success: false,
      backupPath: resolvedBackup,
      targetPath: resolvedTarget,
      bytesRestored: 0,
      error: `Backup file not found: ${resolvedBackup}`,
    };
  }

  // Strict Production Overwrite Safeguard
  if (isProductionDatabasePath(resolvedTarget) && !options.allowProductionOverwrite) {
    return {
      success: false,
      backupPath: resolvedBackup,
      targetPath: resolvedTarget,
      bytesRestored: 0,
      error: `SAFETY GUARD TRIGGERED: Refusing to restore over live production database (${resolvedTarget}) without explicit allowProductionOverwrite flag.`,
    };
  }

  // Pre-restore integrity check on backup file
  const integrity = verifyBackupIntegrity(resolvedBackup);
  if (!integrity.valid) {
    return {
      success: false,
      backupPath: resolvedBackup,
      targetPath: resolvedTarget,
      bytesRestored: 0,
      error: `Backup file failed integrity verification prior to restore: ${integrity.errors?.join('; ')}`,
    };
  }

  const targetDir = path.dirname(resolvedTarget);
  fs.mkdirSync(targetDir, { recursive: true });

  // Stage restoration via temporary file to ensure atomicity
  const stagingPath = `${resolvedTarget}.staging-${Date.now()}`;

  try {
    fs.copyFileSync(resolvedBackup, stagingPath);

    // Verify staged file
    const stagedCheck = verifyBackupIntegrity(stagingPath);
    if (!stagedCheck.valid) {
      fs.unlinkSync(stagingPath);
      return {
        success: false,
        backupPath: resolvedBackup,
        targetPath: resolvedTarget,
        bytesRestored: 0,
        error: `Staged copy failed integrity check: ${stagedCheck.errors?.join('; ')}`,
      };
    }

    // Clean up corresponding WAL and SHM files of target before replace if present
    const targetWal = `${resolvedTarget}-wal`;
    const targetShm = `${resolvedTarget}-shm`;
    if (fs.existsSync(targetWal)) {
      try { fs.unlinkSync(targetWal); } catch { /* ignore */ }
    }
    if (fs.existsSync(targetShm)) {
      try { fs.unlinkSync(targetShm); } catch { /* ignore */ }
    }

    // Atomic replacement
    fs.renameSync(stagingPath, resolvedTarget);

    const stat = fs.statSync(resolvedTarget);

    return {
      success: true,
      backupPath: resolvedBackup,
      targetPath: resolvedTarget,
      bytesRestored: stat.size,
    };
  } catch (err: any) {
    if (fs.existsSync(stagingPath)) {
      try { fs.unlinkSync(stagingPath); } catch { /* ignore */ }
    }
    return {
      success: false,
      backupPath: resolvedBackup,
      targetPath: resolvedTarget,
      bytesRestored: 0,
      error: err?.message || 'Restoration failed during copy/rename',
    };
  }
}

/**
 * Creates coordinated backups of all active system databases into a destination directory.
 */
export async function backupAllDatabases(destinationDirectory: string): Promise<{
  glados?: BackupResult;
  auth?: BackupResult;
}> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const targetDir = path.resolve(destinationDirectory);
  fs.mkdirSync(targetDir, { recursive: true });

  const results: { glados?: BackupResult; auth?: BackupResult } = {};

  // Backup Auth Database
  try {
    const authDb = getAuthDb();
    const authBackupPath = path.join(targetDir, `auth-${ts}.db`);
    results.auth = await createDatabaseBackup(authDb, authBackupPath);
  } catch (err) {
    // Continue if auth isn't configured
  }

  // Backup Glados Database
  try {
    const gladosPath = process.env.GLADOS_DB?.trim() || path.join(process.cwd(), 'data', 'glados.db');
    if (fs.existsSync(gladosPath)) {
      const gladosBackupPath = path.join(targetDir, `glados-${ts}.db`);
      results.glados = await createDatabaseBackup(gladosPath, gladosBackupPath);
    }
  } catch (err) {
    // Continue if glados isn't configured
  }

  return results;
}

