import { z } from 'zod';

/** Allowed RBAC roles in Hazzino BOS. */
export const USER_ROLES = ['super_admin', 'admin', 'manager', 'employee', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const UserRoleSchema = z.enum(USER_ROLES);

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

/** Complete user row stored in the database (internal only). */
export type UserRecord = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: UserRole;
  department_id: string | null;
  is_active: number;
  failed_attempts: number;
  locked_until: number | null;
  password_changed_at: number | null;
  created_at: number;
  updated_at: number;
};

/** Safe, public user object with password hash omitted. */
export type SafeUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  departmentId: string | null;
  isActive: boolean;
  failedAttempts: number;
  lockedUntil: number | null;
  passwordChangedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/** Input required to create a new user. */
export type CreateUserInput = {
  id?: string;
  email: string;
  name: string;
  password?: string;
  passwordHash?: string;
  role: UserRole;
  departmentId?: string | null;
  isActive?: boolean;
};

/** Fields permitted when updating a user's details. */
export type UpdateUserInput = {
  name?: string;
  role?: UserRole;
  departmentId?: string | null;
};

/** Session row stored in the database. */
export type SessionRecord = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  created_at: number;
  last_active_at: number;
  ip_address: string | null;
  user_agent: string | null;
};

/** Safe session domain object. */
export type Session = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  createdAt: number;
  lastActiveAt: number;
  ipAddress: string | null;
  userAgent: string | null;
};

/** Input to create a new session. */
export type CreateSessionInput = {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  ttlSeconds?: number;
};

/** Audit log row stored in the database. */
export type AuditLogRecord = {
  id: string;
  user_id: string | null;
  action: string;
  resource: string;
  details_json: string;
  ip_address: string | null;
  created_at: number;
};

/** Input to record an audit log event. */
export type CreateAuditLogInput = {
  id?: string;
  userId?: string | null;
  action: string;
  resource: string;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
  createdAt?: number;
};

export class EmailAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`User with email "${email}" already exists`);
    this.name = 'EmailAlreadyExistsError';
  }
}

export class InvalidRoleError extends Error {
  constructor(role: unknown) {
    super(`Invalid user role: "${String(role)}". Allowed roles: ${USER_ROLES.join(', ')}`);
    this.name = 'InvalidRoleError';
  }
}

