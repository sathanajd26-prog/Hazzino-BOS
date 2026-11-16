'use client';

import React from 'react';
import { useAuth } from '@/lib/auth/context';
import type { Permission, PermissionContext } from '@/lib/auth/rbac';
import type { UserRole } from '@/lib/auth/types';

export interface CanProps {
  /** The explicit permission required to perform or view this action/element */
  do?: Permission;
  /** Optional minimum role required in the hierarchy */
  role?: UserRole;
  /** Contextual attributes (e.g. department ID or resource owner ID) */
  context?: Omit<PermissionContext, 'user'>;
  /** Element to render if authorized */
  children: React.ReactNode;
  /** Element to render if unauthorized (defaults to null) */
  fallback?: React.ReactNode;
}

/**
 * Declarative component for action-level RBAC gating.
 * Renders `children` if the authenticated user possesses the specified permission/role;
 * otherwise renders `fallback` (or nothing).
 *
 * Examples:
 * ```tsx
 * <Can do="agents:approve">
 *   <button onClick={approve}>Approve</button>
 * </Can>
 *
 * <Can do="clients:create" fallback={<span className="text-muted">Read only</span>}>
 *   <button onClick={create}>New Client</button>
 * </Can>
 * ```
 */
export function Can({ do: actionPermission, role: minRole, context, children, fallback = null }: CanProps) {
  const { user, hasPermission, isRoleAtLeast } = useAuth();

  if (user) {
    if (!user.isActive) {
      return <>{fallback}</>;
    }

    if (actionPermission && !hasPermission(actionPermission, context)) {
      return <>{fallback}</>;
    }

    if (minRole && !isRoleAtLeast(minRole)) {
      return <>{fallback}</>;
    }

    return <>{children}</>;
  }

  // Headless test fallback when rendered without an AuthProvider
  return <>{children}</>;
}

/**
 * Hook variant of the permission check for conditional imperative logic.
 */
export function useCan(
  permission?: Permission,
  context?: Omit<PermissionContext, 'user'>,
): boolean {
  const { user, hasPermission } = useAuth();
  if (!user) return true; // Headless test fallback
  if (!user.isActive || !permission) return false;
  return hasPermission(permission, context);
}

