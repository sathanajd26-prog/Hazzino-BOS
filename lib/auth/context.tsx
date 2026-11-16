'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { SafeUser, UserRole } from '@/lib/auth/types';
import { hasPermission as rbacHasPermission, isRoleAtLeast as rbacIsRoleAtLeast, type Permission, type PermissionContext } from '@/lib/auth/rbac';
import { isBarePath } from '@/lib/bare-routes';

export interface AuthContextValue {
  user: SafeUser | null;
  role: UserRole | null;
  departmentId: string | null;
  permissions: Permission[];
  isLoading: boolean;
  isAuthenticated: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: Permission, context?: Omit<PermissionContext, 'user'>) => boolean;
  isRoleAtLeast: (targetRole: UserRole) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Event dispatched to trigger a real-time re-fetch of current auth and permissions */
export const AUTH_REFRESH_EVENT = 'auth:refresh';
/** Event dispatched by fetch interceptors or API clients when receiving 401 Unauthorized */
export const AUTH_UNAUTHORIZED_EVENT = 'auth:unauthorized';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SafeUser | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const isMountedRef = useRef(true);
  const lastFetchedRef = useRef<number>(0);

  const fetchAuth = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) {
        setIsLoading(true);
      }
      setError(null);

      const res = await fetch('/api/auth/me', {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache, no-store' },
        cache: 'no-store',
      });

      if (!isMountedRef.current) return;

      if (res.ok) {
        const data = await res.json();
        // If account is not active, treat as unauthenticated
        if (!data.user?.isActive) {
          setUser(null);
          setRole(null);
          setDepartmentId(null);
          setPermissions([]);
          if (!isBarePath(pathname)) {
            const dest = pathname && pathname !== '/' ? `/login?next=${encodeURIComponent(pathname)}` : '/login';
            router.replace(dest);
          }
          return;
        }

        setUser(data.user);
        setRole(data.role);
        setDepartmentId(data.departmentId ?? null);
        setPermissions(data.permissions ?? []);
        lastFetchedRef.current = Date.now();
      } else if (res.status === 401) {
        setUser(null);
        setRole(null);
        setDepartmentId(null);
        setPermissions([]);

        // Expired session or unauthenticated: redirect to login if on a protected route
        if (!isBarePath(pathname)) {
          const dest = pathname && pathname !== '/' ? `/login?next=${encodeURIComponent(pathname)}` : '/login';
          router.replace(dest);
        }
      } else {
        // Unexpected server error
        setError(new Error(`Failed to load auth status: HTTP ${res.status}`));
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error('Network error loading auth profile'));
      }
    } finally {
      if (isMountedRef.current && !isBackground) {
        setIsLoading(false);
      }
    }
  }, [pathname, router]);

  // Initial fetch on mount
  useEffect(() => {
    isMountedRef.current = true;
    void fetchAuth(false);
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchAuth]);

  // Live revalidation: re-check on window focus or visibility change to immediately catch role changes or deactivation
  useEffect(() => {
    const handleRevalidate = () => {
      // Throttle live re-checks to at most once every 5 seconds
      if (Date.now() - lastFetchedRef.current > 5000) {
        void fetchAuth(true);
      }
    };

    const handleFocus = () => handleRevalidate();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleRevalidate();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener(AUTH_REFRESH_EVENT, () => void fetchAuth(true));
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, () => {
      setUser(null);
      setRole(null);
      setDepartmentId(null);
      setPermissions([]);
      if (!isBarePath(pathname)) {
        router.replace('/login');
      }
    });

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener(AUTH_REFRESH_EVENT, () => void fetchAuth(true));
    };
  }, [fetchAuth, pathname, router]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if network fails, clear local context
    } finally {
      setUser(null);
      setRole(null);
      setDepartmentId(null);
      setPermissions([]);
      router.replace('/login');
      router.refresh();
    }
  }, [router]);

  const hasPermission = useCallback(
    (permission: Permission, context?: Omit<PermissionContext, 'user'>): boolean => {
      if (!user) return false;
      return rbacHasPermission(user, permission, context);
    },
    [user],
  );

  const isRoleAtLeast = useCallback(
    (targetRole: UserRole): boolean => {
      if (!role) return false;
      return rbacIsRoleAtLeast(role, targetRole);
    },
    [role],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      role,
      departmentId,
      permissions,
      isLoading,
      isAuthenticated: Boolean(user && user.isActive),
      error,
      refetch: () => fetchAuth(false),
      logout,
      hasPermission,
      isRoleAtLeast,
    }),
    [user, role, departmentId, permissions, isLoading, error, fetchAuth, logout, hasPermission, isRoleAtLeast],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

const DEFAULT_AUTH_FALLBACK: AuthContextValue = {
  user: null,
  role: null,
  departmentId: null,
  permissions: [],
  isLoading: false,
  isAuthenticated: false,
  error: null,
  refetch: async () => {},
  logout: async () => {},
  hasPermission: () => false,
  isRoleAtLeast: () => false,
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    return DEFAULT_AUTH_FALLBACK;
  }
  return context;
}

