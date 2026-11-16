import { activeHref, type NavGroup } from '@/lib/nav';
import { isBarePath } from '@/lib/bare-routes';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import type { SafeUser } from '@/lib/auth/types';

/**
 * Single source of truth mapping top-level view routes to explicit RBAC permissions.
 * Reuses the canonical permission identifiers defined in lib/auth/rbac.ts.
 */
export const ROUTE_PERMISSIONS: Record<string, Permission> = {
  '/': 'management:view',
  '/roadmap': 'roadmap:view',
  '/analytics': 'analytics:view',
  '/usage': 'usage:view',
  '/clients': 'clients:view',
  '/funnel': 'funnel:view',
  '/inbox': 'comms:view',
  '/org': 'org:view',
  '/workflows': 'workflows:view',
  '/tasks': 'tasks:view',
  '/creative-engine': 'creative:view',
  '/adpilot': 'adpilot:view',
  '/social': 'social:view',
  '/lead-magnets': 'marketing:view',
  '/lab': 'content_lab:view',
  '/brand-deals': 'brand_deals:view',
  '/skills': 'skills:view',
  '/training': 'training:view',
  '/finances': 'finance:view',
  '/trading': 'trading:view',
  '/agents': 'agents:view',
  '/chats': 'chats:view',
  '/wizard': 'ai_employees:view',
  '/compute': 'compute:view',
  '/brain': 'brain:view',
  '/database': 'database:view',
  '/knowledge': 'knowledge:view',
  '/drift': 'knowledge:view',
  '/integrations': 'settings:view',
  '/blueprint': 'blueprint:view',
  '/setup': 'settings:view',
  '/users': 'users:view',
  '/audit': 'audit:view',
};

/**
 * Resolves the required RBAC Permission for any application pathname or route.
 * Returns null if the path is bare, public, dev-only, or not protected by a specific view permission.
 */
export function getRequiredPermission(pathname: string | null | undefined): Permission | null {
  if (!pathname) return null;
  const clean = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';

  if (isBarePath(clean) || clean.startsWith('/api/') || clean.startsWith('/dev/')) {
    return null;
  }

  // Exact match
  if (ROUTE_PERMISSIONS[clean]) {
    return ROUTE_PERMISSIONS[clean];
  }

  // Match via activeHref prefixing rules (handles sub-routes like /social/beehiiv, /lab/breakouts)
  const baseHref = activeHref(clean);
  if (baseHref && ROUTE_PERMISSIONS[baseHref]) {
    return ROUTE_PERMISSIONS[baseHref];
  }

  // Longest matching prefix
  for (const [route, perm] of Object.entries(ROUTE_PERMISSIONS)) {
    if (route !== '/' && clean.startsWith(`${route}/`)) {
      return perm;
    }
  }

  // Root view default
  if (clean === '/') {
    return ROUTE_PERMISSIONS['/'];
  }

  return null;
}

/**
 * Determines whether a user has authorization to navigate to or view a specific frontend route.
 */
export function canAccessRoute(user: SafeUser | null | undefined, pathname: string): boolean {
  if (isBarePath(pathname)) return true;
  const required = getRequiredPermission(pathname);
  if (!required) return true;
  if (!user || !user.isActive) return false;
  return hasPermission(user, required);
}

/**
 * Filters the sidebar navigation groups based on the authenticated user's permissions.
 * Navigation items are omitted if the user lacks the required view permission.
 * Empty groups (groups with no permitted items) drop out of the navigation entirely.
 */
export function filterNavGroupsByPermissions(
  groups: readonly NavGroup[],
  user: SafeUser | null | undefined,
): NavGroup[] {
  if (!user || !user.isActive) {
    return [];
  }

  return groups
    .map((g) => {
      const items = g.items.filter((item) => {
        const required = getRequiredPermission(item.href);
        return required ? hasPermission(user, required) : true;
      });
      return { ...g, items };
    })
    .filter((g) => g.items.length > 0);
}
