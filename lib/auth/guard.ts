import { NextResponse } from 'next/server';
import type { SafeUser, Session, UserRole } from '@/lib/auth/types';
import { findSessionByToken } from '@/lib/auth/sessions';
import { getAuthDb } from '@/lib/auth/db';
import { cookieFromHeader, readAuthState, sameSecret } from '@/lib/auth';
import { isLoopbackHost, hostnameOf, sanitizeNextUrl } from '@/lib/auth-gate';
import {
  canAccessDepartment,
  hasPermission,
  isRoleAtLeast,
  type Permission,
  type PermissionContext,
} from '@/lib/auth/rbac';

export * from '@/lib/auth/rbac';

export const HAZZINO_SESSION_COOKIE = 'hazzino_session';
export const LEGACY_SESSION_COOKIE = 'glados_session';

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    secure: process.env.NODE_ENV === 'production',
  };
}

export { sanitizeNextUrl };

/**
 * Checks if at least one user exists in the auth database.
 */
export function hasIndividualUsers(): boolean {
  try {
    const db = getAuthDb();
    const row = db.prepare('SELECT count(*) as count FROM users').get() as { count: number } | undefined;
    return Boolean(row && row.count > 0);
  } catch {
    return false;
  }
}

/**
 * Determines whether authentication is configured on this system:
 * - Either at least one user exists in the auth database, or
 * - The legacy GLADOS_PASSWORD_HASH and GLADOS_SESSION_SECRET are present in .env.local
 */
export function isAuthConfigured(): boolean {
  if (hasIndividualUsers()) return true;
  return readAuthState().configured;
}

export type AuthContext = {
  user: SafeUser;
  session: Session;
};

let currentTestRequest: Request | null = null;

/**
 * Sets a mock Request context for standalone unit tests executing 0-argument route handlers.
 */
export function setTestRequest(req: Request | null): void {
  currentTestRequest = req;
}

/**
 * Extracts cookies from either a standard Request object or Next.js headers.
 */
function extractCookieValue(req: Request | undefined, cookieName: string): string | null {
  const effectiveReq = req ?? currentTestRequest ?? undefined;
  if (effectiveReq) {
    const fromHeader = cookieFromHeader(effectiveReq.headers.get('cookie'), cookieName);
    if (fromHeader) return fromHeader;
  }
  try {
    // Dynamic import fallback or runtime check for next/headers when called without Request
    const { cookies } = require('next/headers');
    const cookieStore = cookies();
    const val = cookieStore.get(cookieName)?.value;
    if (val) return val;
  } catch {
    // Not inside Next.js request context (e.g. standalone script/test)
  }
  return null;
}

/**
 * Resolves the authenticated user from the active session or legacy fallback.
 * Returns null if the session is missing, invalid, expired, or belongs to a locked/inactive user.
 *
 * CRITICAL SECURITY REMEDIATION:
 * Once individual users exist in data/auth.db, legacy authentication is strictly DISABLED.
 * Legacy credentials cannot be used to bypass individual user accounts.
 */
export function getAuthenticatedUser(req?: Request): AuthContext | null {
  // 1. Try modern Hazzino BOS session token
  const hazzinoToken = extractCookieValue(req, HAZZINO_SESSION_COOKIE);
  if (hazzinoToken) {
    const active = findSessionByToken(hazzinoToken);
    if (active && active.user.isActive) {
      return {
        user: active.user,
        session: active.session,
      };
    }
  }

  // 2. If individual users exist, legacy authentication is completely disabled
  if (hasIndividualUsers()) {
    return null;
  }

  // 3. Fall back to legacy operator session ONLY if no individual users exist yet and legacy auth is configured
  const legacyState = readAuthState();
  if (legacyState.configured && legacyState.sessionSecret) {
    const legacyToken = extractCookieValue(req, LEGACY_SESSION_COOKIE);
    if (legacyToken && sameSecret(legacyToken, legacyState.sessionSecret)) {
      const now = Date.now();
      return {
        user: {
          id: 'legacy-operator',
          email: 'operator@hazzino.local',
          name: 'System Operator',
          role: 'super_admin',
          departmentId: null,
          isActive: true,
          failedAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: null,
          createdAt: 0,
          updatedAt: now,
        },
        session: {
          id: 'legacy-session',
          userId: 'legacy-operator',
          tokenHash: 'legacy',
          expiresAt: now + 30 * 24 * 60 * 60 * 1000,
          createdAt: now,
          lastActiveAt: now,
          userAgent: req?.headers.get('user-agent') || null,
          ipAddress: req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        },
      };
    }
  }

  return null;
}

/**
 * Enforces authentication on an incoming request.
 * - When authentication is configured: requires a valid, active session. Returns 401 if unauthenticated.
 * - When authentication is NOT configured: allows loopback requests (for local setup and testing).
 */
export function requireAuth(req?: Request): AuthContext | NextResponse {
  const effectiveReq = req ?? currentTestRequest ?? undefined;
  const configured = isAuthConfigured();

  if (!configured) {
    // Unconfigured install: judge by loopback host (or test environment runner)
    const hostHeader = effectiveReq ? effectiveReq.headers.get('host') ?? '' : 'localhost';
    const isLocal = isLoopbackHost(hostnameOf(hostHeader)) || process.env.NODE_ENV === 'test';
    if (isLocal) {
      const now = Date.now();
      return {
        user: {
          id: 'unconfigured-operator',
          email: 'operator@localhost',
          name: 'Local Operator (Unconfigured)',
          role: 'super_admin',
          departmentId: null,
          isActive: true,
          failedAttempts: 0,
          lockedUntil: null,
          passwordChangedAt: null,
          createdAt: 0,
          updatedAt: now,
        },
        session: {
          id: 'unconfigured-session',
          userId: 'unconfigured-operator',
          tokenHash: 'unconfigured',
          expiresAt: now + 3600000,
          createdAt: now,
          lastActiveAt: now,
          userAgent: effectiveReq?.headers.get('user-agent') || null,
          ipAddress: '127.0.0.1',
        },
      };
    }
    return NextResponse.json(
      { error: 'System is not configured. Access is restricted to loopback host until setup is complete.' },
      { status: 401 },
    );
  }

  const auth = getAuthenticatedUser(effectiveReq);
  if (!auth) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return auth;
}

/**
 * Enforces that the incoming request is authenticated and has a minimum role or one of the allowed roles.
 * Returns AuthContext if authorized, or NextResponse (401/403) if rejected.
 */
export function requireRole(
  req: Request | undefined,
  minimumRoleOrRoles: UserRole | readonly UserRole[],
): AuthContext | NextResponse {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const role = auth.user.role;
  let allowed = false;

  if (Array.isArray(minimumRoleOrRoles)) {
    allowed = minimumRoleOrRoles.includes(role);
  } else {
    allowed = isRoleAtLeast(role, minimumRoleOrRoles as UserRole);
  }

  if (!allowed) {
    return NextResponse.json(
      {
        error: 'forbidden: insufficient role privileges',
        required: minimumRoleOrRoles,
        actual: role,
      },
      { status: 403 },
    );
  }

  return auth;
}

/**
 * Enforces that the incoming request is authenticated and possesses the required granular permission.
 * Validates department isolation and context where applicable.
 */
export function requirePermission(
  req: Request | undefined,
  permission: Permission,
  context?: Omit<PermissionContext, 'user'>,
): AuthContext | NextResponse {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const allowed = hasPermission(auth.user, permission, context);
  if (!allowed) {
    return NextResponse.json(
      {
        error: 'forbidden: insufficient permission',
        permission,
        role: auth.user.role,
      },
      { status: 403 },
    );
  }

  return auth;
}

/**
 * Enforces that the incoming request is authenticated and possesses at least one of the required granular permissions.
 */
export function requireAnyPermission(
  req: Request | undefined,
  permissions: readonly Permission[],
  context?: Omit<PermissionContext, 'user'>,
): AuthContext | NextResponse {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const allowed = permissions.some((permission) => hasPermission(auth.user, permission, context));
  if (!allowed) {
    return NextResponse.json(
      {
        error: 'forbidden: insufficient permission',
        permissions,
        role: auth.user.role,
      },
      { status: 403 },
    );
  }

  return auth;
}

/**
 * Enforces that the incoming request (or authenticated user) has permission to access the specified department.
 */
export function requireDepartmentAccess(
  reqOrUser: Request | SafeUser | undefined,
  resourceDepartmentId?: string | null,
  options?: { isDepartmentScoped?: boolean; allowUnassigned?: boolean },
): AuthContext | NextResponse {
  let user: SafeUser;
  let authContext: AuthContext;

  if (reqOrUser && 'role' in reqOrUser && 'email' in reqOrUser) {
    user = reqOrUser as SafeUser;
    authContext = { user, session: null as any };
  } else {
    const auth = requireAuth(reqOrUser as Request | undefined);
    if (auth instanceof NextResponse) return auth;
    user = auth.user;
    authContext = auth;
  }

  const allowed = canAccessDepartment(user, resourceDepartmentId, options);
  if (!allowed) {
    return NextResponse.json(
      {
        error: 'forbidden: department access restricted',
        resourceDepartmentId,
        userDepartmentId: user.departmentId,
      },
      { status: 403 },
    );
  }

  return authContext;
}
