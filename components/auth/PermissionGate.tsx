'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth/context';
import { canAccessRoute, getRequiredPermission } from '@/lib/auth/nav-permissions';
import { AccessDenied } from '@/components/auth/AccessDenied';
import { isBarePath } from '@/lib/bare-routes';
import type { UiStyle } from '@/lib/appearance';

export interface PermissionGateProps {
  children: React.ReactNode;
  ui?: UiStyle;
}

/**
 * Route-level permission gate. Protects pages against direct URL navigation when the user
 * lacks the necessary RBAC view permission. Displays a standardized 403 Access Denied view.
 */
export function PermissionGate({ children, ui = 'classic' }: PermissionGateProps) {
  const pathname = usePathname() ?? '/';
  const { user, role, isLoading } = useAuth();

  // Bare paths like /login are always accessible
  if (isBarePath(pathname)) {
    return <>{children}</>;
  }

  const required = getRequiredPermission(pathname);

  // If no permission is required for this route (e.g. dev pages or public views)
  if (!required) {
    return <>{children}</>;
  }

  // While checking auth on initial page load, prevent flash of protected content
  if (isLoading) {
    return (
      <div className="grid min-h-[50vh] place-items-center text-[13px] text-os-muted" aria-busy="true">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 animate-pulse rounded-full bg-os-accent" />
          <span>Verifying access…</span>
        </div>
      </div>
    );
  }

  // Direct route check: if user is not authorized, render 403 Access Denied
  if (!canAccessRoute(user, pathname)) {
    return (
      <AccessDenied
        pathname={pathname}
        requiredPermission={required}
        userRole={role}
        ui={ui}
      />
    );
  }

  return <>{children}</>;
}

