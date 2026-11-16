import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { getAuthDb } from './db';
import type { AuditLogRecord, CreateAuditLogInput } from './types';

function isDb(val: unknown): val is Database.Database {
  return typeof val === 'object' && val !== null && typeof (val as any).prepare === 'function';
}

/**
 * Append an immutable audit log entry for security and data mutation tracking.
 */
export function recordAuditLog(input: CreateAuditLogInput): AuditLogRecord;
export function recordAuditLog(db: Database.Database, input: CreateAuditLogInput): AuditLogRecord;
export function recordAuditLog(
  dbOrInput: Database.Database | CreateAuditLogInput,
  maybeInput?: CreateAuditLogInput,
): AuditLogRecord {
  const db = isDb(dbOrInput) ? dbOrInput : getAuthDb();
  const input = isDb(dbOrInput) ? maybeInput! : dbOrInput;

  const id = input.id ?? randomUUID();
  const now = input.createdAt ?? Date.now();
  const detailsJson = input.details ? JSON.stringify(input.details) : '{}';
  const ipAddress = input.ipAddress?.trim() || null;
  const resource = input.resource ?? 'auth';

  db.prepare(`
    INSERT INTO audit_logs (
      id, user_id, action, resource, details_json, ip_address, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.userId ?? null, input.action, resource, detailsJson, ipAddress, now);

  const created = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id) as AuditLogRecord;
  return created;
}

/**
 * List recent audit logs with optional filtering.
 */
export function listAuditLogs(filter?: { userId?: string; action?: string; limit?: number }): AuditLogRecord[];
export function listAuditLogs(db: Database.Database, filter?: { userId?: string; action?: string; limit?: number }): AuditLogRecord[];
export function listAuditLogs(
  dbOrFilter?: Database.Database | { userId?: string; action?: string; limit?: number },
  maybeFilter?: { userId?: string; action?: string; limit?: number },
): AuditLogRecord[] {
  const db = isDb(dbOrFilter) ? dbOrFilter : getAuthDb();
  const filter = isDb(dbOrFilter) ? maybeFilter : dbOrFilter;

  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter?.userId) {
    clauses.push('user_id = ?');
    params.push(filter.userId);
  }

  if (filter?.action) {
    clauses.push('action = ?');
    params.push(filter.action);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter?.limit ?? 100;

  const rows = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit) as AuditLogRecord[];
  return rows;
}
