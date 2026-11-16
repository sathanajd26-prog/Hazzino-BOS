import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ROUTE_PERMISSIONS,
  getRequiredPermission,
  canAccessRoute,
  filterNavGroupsByPermissions,
} from '@/lib/auth/nav-permissions';
import { AccessDenied } from '@/components/auth/AccessDenied';
import { NAV_GROUPS, type NavGroup } from '@/lib/nav';
import type { SafeUser, UserRole } from '@/lib/auth/types';
import { hasPermission } from '@/lib/auth/rbac';

function makeUser(role: UserRole, isActive = true, departmentId: string | null = null): SafeUser {
  return {
    id: `usr_${role}_001`,
    email: `${role}@hazzino.test`,
    name: `${role} User`,
    role,
    departmentId,
    isActive,
    failedAttempts: 0,
    lockedUntil: null,
    passwordChangedAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('Phase 5D-4: Frontend Role-Based Navigation & Access Control', () => {
  describe('Route-to-Permission Mapping (lib/auth/nav-permissions.ts)', () => {
    it('maps every top-level navigation route to an explicit RBAC permission', () => {
      expect(ROUTE_PERMISSIONS['/']).toBe('management:view');
      expect(ROUTE_PERMISSIONS['/roadmap']).toBe('roadmap:view');
      expect(ROUTE_PERMISSIONS['/analytics']).toBe('analytics:view');
      expect(ROUTE_PERMISSIONS['/usage']).toBe('usage:view');
      expect(ROUTE_PERMISSIONS['/clients']).toBe('clients:view');
      expect(ROUTE_PERMISSIONS['/funnel']).toBe('funnel:view');
      expect(ROUTE_PERMISSIONS['/inbox']).toBe('comms:view');
      expect(ROUTE_PERMISSIONS['/org']).toBe('org:view');
      expect(ROUTE_PERMISSIONS['/workflows']).toBe('workflows:view');
      expect(ROUTE_PERMISSIONS['/tasks']).toBe('tasks:view');
      expect(ROUTE_PERMISSIONS['/creative-engine']).toBe('creative:view');
      expect(ROUTE_PERMISSIONS['/adpilot']).toBe('adpilot:view');
      expect(ROUTE_PERMISSIONS['/social']).toBe('social:view');
      expect(ROUTE_PERMISSIONS['/lead-magnets']).toBe('marketing:view');
      expect(ROUTE_PERMISSIONS['/lab']).toBe('content_lab:view');
      expect(ROUTE_PERMISSIONS['/brand-deals']).toBe('brand_deals:view');
      expect(ROUTE_PERMISSIONS['/skills']).toBe('skills:view');
      expect(ROUTE_PERMISSIONS['/finances']).toBe('finance:view');
      expect(ROUTE_PERMISSIONS['/trading']).toBe('trading:view');
      expect(ROUTE_PERMISSIONS['/agents']).toBe('agents:view');
      expect(ROUTE_PERMISSIONS['/chats']).toBe('chats:view');
      expect(ROUTE_PERMISSIONS['/wizard']).toBe('ai_employees:view');
      expect(ROUTE_PERMISSIONS['/compute']).toBe('compute:view');
      expect(ROUTE_PERMISSIONS['/brain']).toBe('brain:view');
      expect(ROUTE_PERMISSIONS['/database']).toBe('database:view');
      expect(ROUTE_PERMISSIONS['/knowledge']).toBe('knowledge:view');
      expect(ROUTE_PERMISSIONS['/drift']).toBe('knowledge:view');
      expect(ROUTE_PERMISSIONS['/integrations']).toBe('settings:view');
      expect(ROUTE_PERMISSIONS['/blueprint']).toBe('blueprint:view');
      expect(ROUTE_PERMISSIONS['/setup']).toBe('settings:view');
    });

    it('resolves sub-routes to the parent view permission via activeHref prefixing', () => {
      expect(getRequiredPermission('/social/beehiiv')).toBe('social:view');
      expect(getRequiredPermission('/social/instagram')).toBe('social:view');
      expect(getRequiredPermission('/lab/breakouts')).toBe('content_lab:view');
      expect(getRequiredPermission('/lab/creatorverse')).toBe('content_lab:view');
      expect(getRequiredPermission('/integrations/whatsapp')).toBe('settings:view');
      expect(getRequiredPermission('/agents/setup/crm-pulse')).toBe('agents:view');
    });

    it('returns null for bare, public, API and dev paths', () => {
      expect(getRequiredPermission('/login')).toBeNull();
      expect(getRequiredPermission('/api/auth/me')).toBeNull();
      expect(getRequiredPermission('/dev/g-kit')).toBeNull();
      expect(getRequiredPermission(null)).toBeNull();
      expect(getRequiredPermission('')).toBeNull();
    });
  });

  describe('Route Authorization Evaluation (canAccessRoute)', () => {
    const superAdmin = makeUser('super_admin');
    const admin = makeUser('admin');
    const manager = makeUser('manager');
    const employee = makeUser('employee');
    const viewer = makeUser('viewer');
    const inactiveUser = makeUser('admin', false);

    it('allows bare public routes (/login) unconditionally', () => {
      expect(canAccessRoute(null, '/login')).toBe(true);
      expect(canAccessRoute(undefined, '/login')).toBe(true);
      expect(canAccessRoute(inactiveUser, '/login')).toBe(true);
      expect(canAccessRoute(viewer, '/login')).toBe(true);
    });

    it('denies access to protected routes if unauthenticated or inactive', () => {
      expect(canAccessRoute(null, '/')).toBe(false);
      expect(canAccessRoute(undefined, '/clients')).toBe(false);
      expect(canAccessRoute(inactiveUser, '/')).toBe(false);
      expect(canAccessRoute(inactiveUser, '/finances')).toBe(false);
    });

    it('super_admin has universal access to every frontend route', () => {
      for (const route of Object.keys(ROUTE_PERMISSIONS)) {
        expect(canAccessRoute(superAdmin, route)).toBe(true);
      }
    });

    it('admin has broad access to all standard view routes', () => {
      for (const route of Object.keys(ROUTE_PERMISSIONS)) {
        expect(canAccessRoute(admin, route)).toBe(true);
      }
    });

    it('manager, employee, and viewer have view access to standard modules', () => {
      expect(canAccessRoute(manager, '/')).toBe(true);
      expect(canAccessRoute(manager, '/clients')).toBe(true);
      expect(canAccessRoute(manager, '/finances')).toBe(true);

      expect(canAccessRoute(employee, '/')).toBe(true);
      expect(canAccessRoute(employee, '/tasks')).toBe(true);
      expect(canAccessRoute(employee, '/finances')).toBe(true);

      expect(canAccessRoute(viewer, '/')).toBe(true);
      expect(canAccessRoute(viewer, '/analytics')).toBe(true);
      expect(canAccessRoute(viewer, '/brand-deals')).toBe(true);
    });
  });

  describe('Sidebar Navigation Filtering (filterNavGroupsByPermissions)', () => {
    const superAdmin = makeUser('super_admin');
    const admin = makeUser('admin');
    const manager = makeUser('manager');
    const employee = makeUser('employee');
    const viewer = makeUser('viewer');

    it('returns empty array when user is null, undefined, or inactive', () => {
      expect(filterNavGroupsByPermissions(NAV_GROUPS, null)).toEqual([]);
      expect(filterNavGroupsByPermissions(NAV_GROUPS, undefined)).toEqual([]);
      expect(filterNavGroupsByPermissions(NAV_GROUPS, makeUser('admin', false))).toEqual([]);
    });

    it('super_admin sees all navigation groups and all items', () => {
      const filtered = filterNavGroupsByPermissions(NAV_GROUPS, superAdmin);
      expect(filtered.length).toBe(NAV_GROUPS.length);
      const totalOriginalItems = NAV_GROUPS.flatMap((g) => g.items).length;
      const totalFilteredItems = filtered.flatMap((g) => g.items).length;
      expect(totalFilteredItems).toBe(totalOriginalItems);
    });

    it('admin sees all navigation groups and all items', () => {
      const filtered = filterNavGroupsByPermissions(NAV_GROUPS, admin);
      expect(filtered.length).toBe(NAV_GROUPS.length);
      const totalFilteredItems = filtered.flatMap((g) => g.items).length;
      expect(totalFilteredItems).toBe(NAV_GROUPS.flatMap((g) => g.items).length);
    });

    it('manager, employee, and viewer see appropriate view navigation items', () => {
      const managerNav = filterNavGroupsByPermissions(NAV_GROUPS, manager);
      expect(managerNav.length).toBeGreaterThan(0);

      const employeeNav = filterNavGroupsByPermissions(NAV_GROUPS, employee);
      expect(employeeNav.length).toBeGreaterThan(0);

      const viewerNav = filterNavGroupsByPermissions(NAV_GROUPS, viewer);
      expect(viewerNav.length).toBeGreaterThan(0);
    });

    it('completely drops groups when all their items are unauthorized', () => {
      // Create a mock group containing an admin/manager-only route (/users)
      const customGroups: NavGroup[] = [
        {
          id: 'settings',
          title: 'User Management',
          label: 'User Management',
          items: [
            { href: '/users', label: 'Users', icon: NAV_GROUPS[0].items[0].icon, keywords: 'users' },
          ],
        },
      ];

      // Admin has users:view -> group is preserved
      expect(filterNavGroupsByPermissions(customGroups, admin).length).toBe(1);

      // Viewer and employee do not have users:view -> entire group drops out
      expect(filterNavGroupsByPermissions(customGroups, viewer).length).toBe(0);
      expect(filterNavGroupsByPermissions(customGroups, employee).length).toBe(0);
    });
  });

  describe('Action-Level Permission Matrix Enforcement', () => {
    const superAdmin = makeUser('super_admin');
    const admin = makeUser('admin');
    const manager = makeUser('manager');
    const employee = makeUser('employee');
    const viewer = makeUser('viewer');

    it('Deliverable Review (agents:approve): manager, admin, super_admin only', () => {
      expect(hasPermission(superAdmin, 'agents:approve')).toBe(true);
      expect(hasPermission(admin, 'agents:approve')).toBe(true);
      expect(hasPermission(manager, 'agents:approve')).toBe(true);
      expect(hasPermission(employee, 'agents:approve')).toBe(false);
      expect(hasPermission(viewer, 'agents:approve')).toBe(false);
    });

    it('Brand Deals Dispatch (brand_deals:approve): manager, admin, super_admin only', () => {
      expect(hasPermission(superAdmin, 'brand_deals:approve')).toBe(true);
      expect(hasPermission(admin, 'brand_deals:approve')).toBe(true);
      expect(hasPermission(manager, 'brand_deals:approve')).toBe(true);
      expect(hasPermission(employee, 'brand_deals:approve')).toBe(false);
      expect(hasPermission(viewer, 'brand_deals:approve')).toBe(false);
    });

    it('Client Work Launch (clients:approve): manager, admin, super_admin only', () => {
      expect(hasPermission(superAdmin, 'clients:approve')).toBe(true);
      expect(hasPermission(admin, 'clients:approve')).toBe(true);
      expect(hasPermission(manager, 'clients:approve')).toBe(true);
      expect(hasPermission(employee, 'clients:approve')).toBe(false);
      expect(hasPermission(viewer, 'clients:approve')).toBe(false);
    });

    it('Client Work Create (clients:create): manager, admin, super_admin (not employee or viewer)', () => {
      expect(hasPermission(superAdmin, 'clients:create')).toBe(true);
      expect(hasPermission(admin, 'clients:create')).toBe(true);
      expect(hasPermission(manager, 'clients:create')).toBe(true);
      expect(hasPermission(employee, 'clients:create')).toBe(false);
      expect(hasPermission(viewer, 'clients:create')).toBe(false);
    });

    it('Agent Failover & Model Switch (agents:manage): admin and super_admin only', () => {
      expect(hasPermission(superAdmin, 'agents:manage')).toBe(true);
      expect(hasPermission(admin, 'agents:manage')).toBe(true);
      expect(hasPermission(manager, 'agents:manage')).toBe(false);
      expect(hasPermission(employee, 'agents:manage')).toBe(false);
      expect(hasPermission(viewer, 'agents:manage')).toBe(false);
    });

    it('Settings Management (settings:manage): admin and super_admin only', () => {
      expect(hasPermission(superAdmin, 'settings:manage')).toBe(true);
      expect(hasPermission(admin, 'settings:manage')).toBe(true);
      expect(hasPermission(manager, 'settings:manage')).toBe(false);
      expect(hasPermission(employee, 'settings:manage')).toBe(false);
      expect(hasPermission(viewer, 'settings:manage')).toBe(false);
    });

    it('Modules Configuration (modules:manage): admin and super_admin only', () => {
      expect(hasPermission(superAdmin, 'modules:manage')).toBe(true);
      expect(hasPermission(admin, 'modules:manage')).toBe(true);
      expect(hasPermission(manager, 'modules:manage')).toBe(false);
      expect(hasPermission(employee, 'modules:manage')).toBe(false);
      expect(hasPermission(viewer, 'modules:manage')).toBe(false);
    });

    it('API Keys Configuration (keys:manage): admin and super_admin only', () => {
      expect(hasPermission(superAdmin, 'keys:manage')).toBe(true);
      expect(hasPermission(admin, 'keys:manage')).toBe(true);
      expect(hasPermission(manager, 'keys:manage')).toBe(false);
      expect(hasPermission(employee, 'keys:manage')).toBe(false);
      expect(hasPermission(viewer, 'keys:manage')).toBe(false);
    });
  });

  describe('Real-Time Role Updates & Dynamic Re-evaluation', () => {
    it('demoting or elevating a user role immediately updates their route and action permissions without stale cache', () => {
      const user = makeUser('employee');
      expect(hasPermission(user, 'agents:approve')).toBe(false);
      expect(hasPermission(user, 'settings:manage')).toBe(false);

      // Elevate to manager
      const elevatedToManager: SafeUser = { ...user, role: 'manager' };
      expect(hasPermission(elevatedToManager, 'agents:approve')).toBe(true);
      expect(hasPermission(elevatedToManager, 'settings:manage')).toBe(false);

      // Elevate to admin
      const elevatedToAdmin: SafeUser = { ...user, role: 'admin' };
      expect(hasPermission(elevatedToAdmin, 'agents:approve')).toBe(true);
      expect(hasPermission(elevatedToAdmin, 'settings:manage')).toBe(true);

      // Demote to viewer
      const demotedToViewer: SafeUser = { ...user, role: 'viewer' };
      expect(hasPermission(demotedToViewer, 'agents:approve')).toBe(false);
      expect(hasPermission(demotedToViewer, 'clients:create')).toBe(false);
      expect(hasPermission(demotedToViewer, 'tasks:view')).toBe(true);
    });

    it('deactivating an account immediately denies all route and action permissions', () => {
      const admin = makeUser('admin', true);
      expect(canAccessRoute(admin, '/finances')).toBe(true);
      expect(hasPermission(admin, 'finance:view')).toBe(true);

      const deactivatedAdmin = { ...admin, isActive: false };
      expect(canAccessRoute(deactivatedAdmin, '/finances')).toBe(false);
      expect(hasPermission(deactivatedAdmin, 'finance:view')).toBe(false);
      expect(filterNavGroupsByPermissions(NAV_GROUPS, deactivatedAdmin)).toEqual([]);
    });
  });

  describe('AccessDenied UI Component (components/auth/AccessDenied.tsx)', () => {
    it('renders accessible 403 Forbidden alert with role, required permission, and return link in Classic UI', () => {
      const el = createElement(AccessDenied, {
        pathname: '/settings',
        requiredPermission: 'settings:view',
        userRole: 'viewer',
        ui: 'classic',
      });
      const html = renderToStaticMarkup(el);

      expect(html).toContain('role="alert"');
      expect(html).toContain('403 Forbidden — Access Denied');
      expect(html).toContain('settings:view');
      expect(html).toContain('viewer');
      expect(html).toContain('Return to Dashboard');
      expect(html).toContain('href="/"');
      expect(html).toContain('Switch Account');
      expect(html).toContain('href="/login"');
    });

    it('renders GladOS-styled AccessDenied state with error indicator and navigation action', () => {
      const el = createElement(AccessDenied, {
        pathname: '/keys',
        requiredPermission: 'keys:manage',
        userRole: 'employee',
        ui: 'glados',
      });
      const html = renderToStaticMarkup(el);

      expect(html).toContain('role="alert"');
      expect(html).toContain('data-g="GEmpty"');
      expect(html).toContain('Access Denied');
      expect(html).toContain('keys:manage');
      expect(html).toContain('employee');
      expect(html).toContain('Return to Dashboard');
    });
  });
});
