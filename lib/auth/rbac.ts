import type { SafeUser, UserRole } from '@/lib/auth/types';
export type { SafeUser, UserRole } from '@/lib/auth/types';

/**
 * Standard Action types across Hazzino BOS resources.
 */
export type Action = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'manage';

/**
 * Standard Module identifiers in Hazzino BOS.
 */
export type ModuleId =
  | 'management'
  | 'crm'
  | 'hr'
  | 'projects'
  | 'marketing'
  | 'training'
  | 'finance'
  | 'ai_employees'
  | 'knowledge'
  | 'settings'
  | 'system';

/**
 * Explicit, granular RBAC permissions.
 */
export type Permission =
  | '*'
  // Users & Access Control
  | 'users:view'
  | 'users:create'
  | 'users:edit'
  | 'users:delete'
  | 'users:manage'
  | 'roles:assign'
  | 'audit:view'
  // Settings & Configuration
  | 'settings:view'
  | 'settings:manage'
  | 'modules:view'
  | 'modules:manage'
  | 'keys:view'
  | 'keys:manage'
  // Management & Overview
  | 'management:view'
  | 'management:manage'
  | 'roadmap:view'
  | 'roadmap:edit'
  | 'roadmap:manage'
  | 'analytics:view'
  | 'usage:view'
  // CRM & Sales
  | 'crm:view'
  | 'crm:create'
  | 'crm:edit'
  | 'crm:delete'
  | 'crm:manage'
  | 'clients:view'
  | 'clients:create'
  | 'clients:edit'
  | 'clients:delete'
  | 'clients:approve'
  | 'clients:manage'
  | 'funnel:view'
  | 'funnel:create'
  | 'funnel:edit'
  | 'funnel:manage'
  | 'comms:view'
  | 'comms:create'
  | 'comms:edit'
  | 'comms:manage'
  // HR & Org
  | 'hr:view'
  | 'hr:create'
  | 'hr:edit'
  | 'hr:delete'
  | 'hr:manage'
  | 'org:view'
  | 'org:manage'
  // Projects & Tasks
  | 'projects:view'
  | 'projects:create'
  | 'projects:edit'
  | 'projects:delete'
  | 'projects:manage'
  | 'workflows:view'
  | 'workflows:create'
  | 'workflows:edit'
  | 'workflows:delete'
  | 'workflows:approve'
  | 'workflows:manage'
  | 'tasks:view'
  | 'tasks:create'
  | 'tasks:edit'
  | 'tasks:delete'
  | 'tasks:approve'
  | 'tasks:manage'
  // Marketing & Growth
  | 'marketing:view'
  | 'marketing:create'
  | 'marketing:edit'
  | 'marketing:delete'
  | 'marketing:approve'
  | 'marketing:manage'
  | 'creative:view'
  | 'creative:create'
  | 'creative:edit'
  | 'creative:delete'
  | 'creative:manage'
  | 'adpilot:view'
  | 'adpilot:create'
  | 'adpilot:edit'
  | 'adpilot:manage'
  | 'social:view'
  | 'social:create'
  | 'social:edit'
  | 'social:delete'
  | 'social:manage'
  | 'brand_deals:view'
  | 'brand_deals:create'
  | 'brand_deals:edit'
  | 'brand_deals:delete'
  | 'brand_deals:approve'
  | 'brand_deals:manage'
  | 'content_lab:view'
  | 'content_lab:create'
  | 'content_lab:edit'
  | 'content_lab:delete'
  | 'content_lab:manage'
  // Training & SOPs
  | 'training:view'
  | 'training:create'
  | 'training:edit'
  | 'training:manage'
  | 'skills:view'
  | 'skills:create'
  | 'skills:edit'
  | 'skills:delete'
  | 'skills:manage'
  // Finance & Trading
  | 'finance:view'
  | 'finance:create'
  | 'finance:edit'
  | 'finance:delete'
  | 'finance:approve'
  | 'finance:manage'
  | 'trading:view'
  | 'trading:edit'
  | 'trading:manage'
  | 'trading:approve'
  // AI Employees & Workforce
  | 'ai_employees:view'
  | 'ai_employees:create'
  | 'ai_employees:edit'
  | 'ai_employees:manage'
  | 'agents:view'
  | 'agents:run'
  | 'agents:approve'
  | 'agents:manage'
  | 'chats:view'
  | 'chats:create'
  | 'chats:edit'
  | 'chats:delete'
  | 'chats:manage'
  | 'compute:view'
  | 'compute:manage'
  // Knowledge Centre
  | 'knowledge:view'
  | 'knowledge:create'
  | 'knowledge:edit'
  | 'knowledge:delete'
  | 'knowledge:manage'
  | 'brain:view'
  | 'brain:edit'
  | 'brain:manage'
  | 'database:view'
  | 'database:manage'
  | 'blueprint:view'
  | 'blueprint:manage'
  // System Administration & Infrastructure
  | 'system:view'
  | 'system:execute'
  | 'system:manage';

/**
 * Numeric role hierarchy weights.
 * Higher number indicates greater authority.
 */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  super_admin: 100,
  admin: 80,
  manager: 60,
  employee: 40,
  viewer: 20,
};

/**
 * Checks whether userRole is at or above targetRole in the role hierarchy.
 */
export function isRoleAtLeast(userRole: UserRole, targetRole: UserRole): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[targetRole] ?? 0);
}

/**
 * Checks whether actorRole is strictly higher than targetRole in the role hierarchy.
 */
export function hasHigherRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return (ROLE_HIERARCHY[actorRole] ?? 0) > (ROLE_HIERARCHY[targetRole] ?? 0);
}

/**
 * Permission sets granted to non-super_admin roles.
 */
const ADMIN_PERMISSIONS: Set<Permission> = new Set([
  'users:view', 'users:create', 'users:edit', 'users:delete', 'users:manage',
  'roles:assign',
  'audit:view',
  'settings:view', 'settings:manage',
  'modules:view', 'modules:manage',
  'keys:view', 'keys:manage',
  'management:view', 'management:manage',
  'roadmap:view', 'roadmap:edit', 'roadmap:manage',
  'analytics:view', 'usage:view',
  'crm:view', 'crm:create', 'crm:edit', 'crm:delete', 'crm:manage',
  'clients:view', 'clients:create', 'clients:edit', 'clients:delete', 'clients:approve', 'clients:manage',
  'funnel:view', 'funnel:create', 'funnel:edit', 'funnel:manage',
  'comms:view', 'comms:create', 'comms:edit', 'comms:manage',
  'hr:view', 'hr:create', 'hr:edit', 'hr:delete', 'hr:manage',
  'org:view', 'org:manage',
  'projects:view', 'projects:create', 'projects:edit', 'projects:delete', 'projects:manage',
  'workflows:view', 'workflows:create', 'workflows:edit', 'workflows:delete', 'workflows:approve', 'workflows:manage',
  'tasks:view', 'tasks:create', 'tasks:edit', 'tasks:delete', 'tasks:approve', 'tasks:manage',
  'marketing:view', 'marketing:create', 'marketing:edit', 'marketing:delete', 'marketing:approve', 'marketing:manage',
  'creative:view', 'creative:create', 'creative:edit', 'creative:delete', 'creative:manage',
  'adpilot:view', 'adpilot:create', 'adpilot:edit', 'adpilot:manage',
  'social:view', 'social:create', 'social:edit', 'social:delete', 'social:manage',
  'brand_deals:view', 'brand_deals:create', 'brand_deals:edit', 'brand_deals:delete', 'brand_deals:approve', 'brand_deals:manage',
  'content_lab:view', 'content_lab:create', 'content_lab:edit', 'content_lab:delete', 'content_lab:manage',
  'training:view', 'training:create', 'training:edit', 'training:manage',
  'skills:view', 'skills:create', 'skills:edit', 'skills:delete', 'skills:manage',
  'finance:view', 'finance:create', 'finance:edit', 'finance:delete', 'finance:approve', 'finance:manage',
  'trading:view', 'trading:edit', 'trading:manage', 'trading:approve',
  'ai_employees:view', 'ai_employees:create', 'ai_employees:edit', 'ai_employees:manage',
  'agents:view', 'agents:run', 'agents:approve', 'agents:manage',
  'chats:view', 'chats:create', 'chats:edit', 'chats:delete', 'chats:manage',
  'compute:view', 'compute:manage',
  'knowledge:view', 'knowledge:create', 'knowledge:edit', 'knowledge:delete', 'knowledge:manage',
  'brain:view', 'brain:edit', 'brain:manage',
  'database:view', 'database:manage',
  'blueprint:view', 'blueprint:manage',
  'system:view', 'system:execute',
]);

const MANAGER_PERMISSIONS: Set<Permission> = new Set([
  'users:view',
  'settings:view',
  'modules:view',
  'management:view',
  'roadmap:view', 'roadmap:edit',
  'analytics:view', 'usage:view',
  'crm:view', 'crm:create', 'crm:edit',
  'clients:view', 'clients:create', 'clients:edit', 'clients:approve',
  'funnel:view', 'funnel:create', 'funnel:edit',
  'comms:view', 'comms:create', 'comms:edit',
  'hr:view', 'hr:create', 'hr:edit', 'org:view',
  'projects:view', 'projects:create', 'projects:edit',
  'workflows:view', 'workflows:create', 'workflows:edit', 'workflows:approve',
  'tasks:view', 'tasks:create', 'tasks:edit', 'tasks:delete', 'tasks:approve',
  'marketing:view', 'marketing:create', 'marketing:edit', 'marketing:approve',
  'creative:view', 'creative:create', 'creative:edit',
  'adpilot:view', 'adpilot:create', 'adpilot:edit',
  'social:view', 'social:create', 'social:edit', 'social:delete',
  'brand_deals:view', 'brand_deals:create', 'brand_deals:edit', 'brand_deals:approve',
  'content_lab:view', 'content_lab:create', 'content_lab:edit', 'content_lab:delete',
  'training:view', 'training:create', 'training:edit',
  'skills:view', 'skills:create', 'skills:edit',
  'finance:view',
  'trading:view',
  'ai_employees:view',
  'agents:view', 'agents:run', 'agents:approve',
  'chats:view', 'chats:create', 'chats:edit', 'chats:delete',
  'compute:view',
  'knowledge:view', 'knowledge:create', 'knowledge:edit',
  'brain:view', 'database:view', 'blueprint:view',
  'system:view',
]);

const EMPLOYEE_PERMISSIONS: Set<Permission> = new Set([
  'settings:view',
  'modules:view',
  'management:view',
  'roadmap:view',
  'analytics:view', 'usage:view',
  'crm:view', 'crm:create', 'crm:edit',
  'clients:view',
  'funnel:view',
  'comms:view', 'comms:create',
  'hr:view', 'org:view',
  'projects:view', 'projects:create', 'projects:edit',
  'workflows:view', 'workflows:create', 'workflows:edit',
  'tasks:view', 'tasks:create', 'tasks:edit',
  'marketing:view', 'marketing:create', 'marketing:edit',
  'creative:view', 'creative:create', 'creative:edit',
  'adpilot:view',
  'social:view', 'social:create', 'social:edit',
  'brand_deals:view',
  'content_lab:view', 'content_lab:create', 'content_lab:edit',
  'training:view',
  'skills:view',
  'finance:view',
  'trading:view',
  'ai_employees:view',
  'agents:view', 'agents:run',
  'chats:view', 'chats:create', 'chats:edit',
  'compute:view',
  'knowledge:view',
  'brain:view', 'database:view', 'blueprint:view',
]);

const VIEWER_PERMISSIONS: Set<Permission> = new Set([
  'settings:view',
  'modules:view',
  'management:view',
  'roadmap:view',
  'analytics:view', 'usage:view',
  'crm:view',
  'clients:view',
  'funnel:view',
  'comms:view',
  'hr:view', 'org:view',
  'projects:view',
  'workflows:view',
  'tasks:view',
  'marketing:view',
  'creative:view',
  'adpilot:view',
  'social:view',
  'brand_deals:view',
  'content_lab:view',
  'training:view',
  'skills:view',
  'finance:view',
  'trading:view',
  'ai_employees:view',
  'agents:view',
  'chats:view',
  'compute:view',
  'knowledge:view',
  'brain:view', 'database:view', 'blueprint:view',
]);

/**
 * Contextual attributes for permission and resource validation.
 */
export type PermissionContext = {
  user: SafeUser;
  resourceDepartmentId?: string | null;
  isDepartmentScoped?: boolean;
  ownerUserId?: string | null;
  targetUserId?: string | null;
  targetRole?: UserRole | null;
};

/**
 * Checks if a user has access to a specific department's resource.
 *
 * Rules:
 * - super_admin and admin have unrestricted access across all departments.
 * - If resource is department-scoped and resourceDepartmentId is unassigned/null/empty:
 *   - Only super_admin and admin can access unassigned legacy records.
 * - Global resources (resourceDepartmentId is null/undefined/empty and not department-scoped) are accessible to all.
 * - If resourceDepartmentId is specified:
 *   - Managers and employees can access resources in their own assigned department.
 *   - Cross-department operations are strictly forbidden for managers and employees.
 */
export function canAccessDepartment(
  user: SafeUser,
  resourceDepartmentId?: string | null,
  options?: { isDepartmentScoped?: boolean; allowUnassigned?: boolean },
): boolean {
  if (!user.isActive) return false;
  if (user.role === 'super_admin' || user.role === 'admin') return true;

  // Unassigned legacy records on department-scoped resources are restricted to admin/super_admin
  if (options?.isDepartmentScoped && !resourceDepartmentId) {
    return false;
  }

  if (!resourceDepartmentId) return true;
  if (!user.departmentId) return false;
  return user.departmentId.toLowerCase() === resourceDepartmentId.toLowerCase();
}

/**
 * Core RBAC permission evaluation engine.
 * Deny by default: If permission is not explicitly granted, returns false.
 */
export function hasPermission(
  user: SafeUser | null | undefined,
  permission: Permission,
  context?: Omit<PermissionContext, 'user'>,
): boolean {
  if (!user || !user.isActive) return false;

  // 1. Super Admin possesses universal wildcard authority
  if (user.role === 'super_admin') return true;

  // 2. Evaluate base role permissions
  let roleHasPermission = false;
  switch (user.role) {
    case 'admin':
      roleHasPermission = ADMIN_PERMISSIONS.has(permission);
      break;
    case 'manager':
      roleHasPermission = MANAGER_PERMISSIONS.has(permission);
      break;
    case 'employee':
      roleHasPermission = EMPLOYEE_PERMISSIONS.has(permission);
      break;
    case 'viewer':
      roleHasPermission = VIEWER_PERMISSIONS.has(permission);
      break;
    default:
      return false; // Deny unknown roles
  }

  if (!roleHasPermission) return false;

  // 3. Department-level isolation check
  // Non-admins cannot access or mutate department-scoped resources outside their assigned department.
  if (user.role !== 'admin' && (context?.resourceDepartmentId !== undefined || context?.isDepartmentScoped)) {
    const canAccess = canAccessDepartment(user, context.resourceDepartmentId, {
      isDepartmentScoped: context.isDepartmentScoped,
    });
    if (!canAccess) {
      return false;
    }
  }

  // 4. Role Assignment & Privilege Escalation check
  if (permission === 'roles:assign' && context?.targetRole) {
    const check = canAssignRole(user, context.targetRole);
    if (!check.allowed) return false;
  }

  return true;
}

/**
 * Guard against unauthorized role assignment (Privilege Escalation Prevention).
 *
 * Rules:
 * - super_admin can assign any role.
 * - admin can only assign roles STRICTLY LOWER than admin (manager, employee, viewer).
 * - admin CANNOT assign super_admin or admin.
 * - manager, employee, and viewer CANNOT assign any roles.
 */
export function canAssignRole(
  actor: SafeUser,
  targetRole: UserRole,
): { allowed: boolean; reason?: string } {
  if (!actor.isActive) return { allowed: false, reason: 'Actor account is inactive' };

  if (actor.role === 'super_admin') {
    return { allowed: true };
  }

  if (actor.role === 'admin') {
    if (targetRole === 'super_admin') {
      return { allowed: false, reason: 'Admins cannot create or promote to Super Admin' };
    }
    if (targetRole === 'admin') {
      return { allowed: false, reason: 'Admins cannot create or promote to Admin' };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: `${actor.role} cannot assign roles` };
}

/**
 * Guard against unauthorized user modification or deletion.
 *
 * Rules:
 * - super_admin can modify any user (except cannot demote/delete the last remaining super_admin).
 * - admin can only modify users with strictly lower roles (manager, employee, viewer).
 * - admin cannot modify or delete other admins or super_admins.
 * - users cannot elevate their own role.
 * - manager, employee, and viewer cannot modify other users.
 */
export function canModifyUser(
  actor: SafeUser,
  targetUser: SafeUser | { id: string; role: UserRole },
  options: { activeSuperAdminCount?: number; newRole?: UserRole } = {},
): { allowed: boolean; reason?: string } {
  if (!actor.isActive) return { allowed: false, reason: 'Actor account is inactive' };

  const isSelf = actor.id === targetUser.id;

  // Last remaining super admin protection takes precedence
  if (targetUser.role === 'super_admin') {
    const isDemotion = options.newRole && options.newRole !== 'super_admin';
    const count = options.activeSuperAdminCount ?? 1;
    if (count <= 1 && isDemotion) {
      return { allowed: false, reason: 'Cannot demote the only remaining active Super Admin' };
    }
  }

  // Self-role elevation attempt
  if (isSelf && options.newRole && options.newRole !== actor.role) {
    return { allowed: false, reason: 'Users cannot change their own role' };
  }

  // Super Admin checks
  if (actor.role === 'super_admin') {
    return { allowed: true };
  }

  // Admin checks
  if (actor.role === 'admin') {
    if (targetUser.role === 'super_admin') {
      return { allowed: false, reason: 'Admins cannot modify Super Admin accounts' };
    }
    if (targetUser.role === 'admin' && !isSelf) {
      return { allowed: false, reason: 'Admins cannot modify other Admin accounts' };
    }
    if (options.newRole) {
      const assignCheck = canAssignRole(actor, options.newRole);
      if (!assignCheck.allowed) return assignCheck;
    }
    return { allowed: true };
  }

  // Non-admins can only modify their own basic profile details (not role)
  if (isSelf) {
    if (options.newRole && options.newRole !== actor.role) {
      return { allowed: false, reason: 'Non-administrators cannot change their own role' };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: 'Insufficient permissions to modify user accounts' };
}

/**
 * Returns the full list of explicit permissions granted to a given role.
 */
export function getRolePermissions(role: UserRole): Permission[] {
  switch (role) {
    case 'super_admin':
      return ['*'];
    case 'admin':
      return Array.from(ADMIN_PERMISSIONS);
    case 'manager':
      return Array.from(MANAGER_PERMISSIONS);
    case 'employee':
      return Array.from(EMPLOYEE_PERMISSIONS);
    case 'viewer':
      return Array.from(VIEWER_PERMISSIONS);
    default:
      return [];
  }
}
