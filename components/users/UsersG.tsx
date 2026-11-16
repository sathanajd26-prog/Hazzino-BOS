'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GButton,
  GCard,
  GDialog,
  GEmpty,
  GErrorLine,
  GField,
  GInput,
  GPage,
  GSectionHeader,
  GSelect,
  GSheet,
  GSkeleton,
  GTable,
  GTag,
  GWell,
  type GColumn,
  type GTagTone,
} from '@/components/g';
import { Can } from '@/components/auth/Can';
import { AUTH_REFRESH_EVENT, useAuth } from '@/lib/auth/context';
import { canAssignRole, canModifyUser } from '@/lib/auth/rbac';
import type { SafeUser, UserRole } from '@/lib/auth/types';
import { USER_ROLES } from '@/lib/auth/types';
import {
  Building2,
  CheckCircle2,
  Edit2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  employee: 'Employee',
  viewer: 'Viewer',
};

const ROLE_TONES: Record<UserRole, GTagTone> = {
  super_admin: 'accent',
  admin: 'warn',
  manager: 'neutral',
  employee: 'neutral',
  viewer: 'outline',
};

interface Department {
  id: string;
  name: string;
}

export function UsersG() {
  const { user: currentUser, refetch: refetchAuth } = useAuth();

  const [users, setUsers] = useState<SafeUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');

  // Modals & Dialogs state
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<SafeUser | null>(null);
  const [deactivateConfirm, setDeactivateConfirm] = useState<{
    user: SafeUser;
    action: 'activate' | 'deactivate';
  } | null>(null);

  // Form states
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'employee' as UserRole,
    departmentId: '',
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [editForm, setEditForm] = useState({
    name: '',
    role: 'employee' as UserRole,
    departmentId: '',
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const [isDeactivating, setIsDeactivating] = useState(false);

  // Load users and departments
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [usersRes, deptsRes] = await Promise.all([
        fetch('/api/users', { cache: 'no-store' }),
        fetch('/api/departments', { cache: 'no-store' }),
      ]);

      if (!usersRes.ok) {
        throw new Error(`Failed to load users: HTTP ${usersRes.status}`);
      }

      const usersData = await usersRes.json();
      setUsers(usersData.users || []);

      if (deptsRes.ok) {
        const deptsData = await deptsRes.json();
        setDepartments(deptsData.departments || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user management data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Derived counts
  const activeSuperAdminCount = useMemo(
    () => users.filter((u) => u.role === 'super_admin' && u.isActive).length,
    [users],
  );

  const activeUserCount = useMemo(() => users.filter((u) => u.isActive).length, [users]);

  // Roles assignable by the current actor
  const assignableRoles = useMemo(() => {
    if (!currentUser) return [];
    return USER_ROLES.filter((r) => canAssignRole(currentUser, r).allowed);
  }, [currentUser]);

  // Department map for quick lookup
  const departmentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of departments) {
      map.set(d.id, d.name);
    }
    return map;
  }, [departments]);

  // Filtered rows
  const filteredUsers = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (filterRole !== 'all' && u.role !== filterRole) return false;
      if (!q) return true;
      const deptName = u.departmentId ? departmentMap.get(u.departmentId) || u.departmentId : '';
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        deptName.toLowerCase().includes(q)
      );
    });
  }, [users, filterQuery, filterRole, departmentMap]);

  // Handle open create modal
  const openCreateModal = () => {
    const defaultRole = assignableRoles[0] || 'employee';
    setCreateForm({
      name: '',
      email: '',
      password: '',
      role: defaultRole,
      departmentId: currentUser?.departmentId || '',
    });
    setCreateError(null);
    setCreateOpen(true);
  };

  // Handle submit create
  const handleCreateSubmit = async () => {
    if (!createForm.name.trim()) {
      setCreateError('Name is required');
      return;
    }
    if (!createForm.email.trim() || !createForm.email.includes('@')) {
      setCreateError('Valid email address is required');
      return;
    }
    if (!createForm.password || createForm.password.length < 8) {
      setCreateError('Temporary password must be at least 8 characters long');
      return;
    }

    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createForm.name.trim(),
          email: createForm.email.trim(),
          password: createForm.password,
          role: createForm.role,
          departmentId: createForm.departmentId.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Error ${res.status}: Failed to create user`);
      }

      setSuccess(`User "${createForm.name}" created successfully`);
      setCreateOpen(false);
      await loadData();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsCreating(false);
    }
  };

  // Handle open edit modal
  const openEditModal = (target: SafeUser) => {
    setEditUser(target);
    setEditForm({
      name: target.name,
      role: target.role,
      departmentId: target.departmentId || '',
    });
    setEditError(null);
  };

  // Handle submit edit
  const handleEditSubmit = async () => {
    if (!editUser) return;
    if (!editForm.name.trim()) {
      setEditError('Name cannot be empty');
      return;
    }

    setIsUpdating(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/users/${editUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          role: editForm.role,
          departmentId: editForm.departmentId.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Error ${res.status}: Failed to update user`);
      }

      setSuccess(`User "${editForm.name}" updated successfully`);
      setEditUser(null);
      await loadData();

      // If actor modified their own details, refresh session context
      if (currentUser?.id === editUser.id) {
        window.dispatchEvent(new Event(AUTH_REFRESH_EVENT));
        refetchAuth();
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update user');
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle deactivate/activate confirmation
  const handleToggleActiveSubmit = async () => {
    if (!deactivateConfirm) return;
    const { user: target, action } = deactivateConfirm;
    const nextActive = action === 'activate';

    setIsDeactivating(true);
    try {
      const res = await fetch(`/api/users/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: nextActive }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Error ${res.status}: Failed to update status`);
      }

      setSuccess(
        nextActive
          ? `Account "${target.name}" activated.`
          : `Account "${target.name}" deactivated. Active sessions terminated.`,
      );
      setDeactivateConfirm(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to modify account status');
    } finally {
      setIsDeactivating(false);
    }
  };

  // Evaluate canModify and reasons for a specific user
  const getUserModifyState = useCallback(
    (target: SafeUser) => {
      if (!currentUser) return { canEdit: false, editReason: 'Unauthenticated' };
      const mod = canModifyUser(currentUser, target, { activeSuperAdminCount });
      return {
        canEdit: mod.allowed,
        editReason: mod.reason,
      };
    },
    [currentUser, activeSuperAdminCount],
  );

  // Evaluate deactivation permissions for a user
  const getUserDeactivateState = useCallback(
    (target: SafeUser) => {
      if (!currentUser) return { allowed: false, reason: 'Unauthenticated' };
      if (currentUser.id === target.id) {
        return { allowed: false, reason: 'Cannot deactivate your own account' };
      }
      if (target.role === 'super_admin' && target.isActive && activeSuperAdminCount <= 1) {
        return { allowed: false, reason: 'Cannot deactivate the only active Super Admin' };
      }
      if (currentUser.role === 'admin' && (target.role === 'admin' || target.role === 'super_admin')) {
        return { allowed: false, reason: 'Admins cannot deactivate other administrators' };
      }
      const mod = canModifyUser(currentUser, target, { activeSuperAdminCount });
      if (!mod.allowed) {
        return { allowed: false, reason: mod.reason || 'Insufficient permissions' };
      }
      return { allowed: true };
    },
    [currentUser, activeSuperAdminCount],
  );

  // Table Columns
  const columns: GColumn<SafeUser>[] = useMemo(
    () => [
      {
        key: 'name',
        label: 'User',
        sortValue: (u) => u.name.toLowerCase(),
        render: (u) => (
          <div className="flex flex-col min-w-0 py-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{u.name}</span>
              {currentUser?.id === u.id && (
                <GTag size="xs" tone="accent">
                  You
                </GTag>
              )}
            </div>
            <span className="text-xs text-muted-foreground truncate">{u.email}</span>
          </div>
        ),
      },
      {
        key: 'role',
        label: 'Role',
        sortValue: (u) => u.role,
        render: (u) => (
          <GTag tone={ROLE_TONES[u.role] || 'neutral'} size="sm">
            {ROLE_LABELS[u.role] || u.role}
          </GTag>
        ),
      },
      {
        key: 'department',
        label: 'Department',
        sortValue: (u) => (u.departmentId ? departmentMap.get(u.departmentId) || u.departmentId : ''),
        render: (u) => {
          const deptName = u.departmentId ? departmentMap.get(u.departmentId) || u.departmentId : null;
          return deptName ? (
            <span className="text-xs flex items-center gap-1.5 font-medium">
              <Building2 size={12} className="opacity-60" />
              {deptName}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground italic">Global / All</span>
          );
        },
      },
      {
        key: 'status',
        label: 'Status',
        sortValue: (u) => (u.isActive ? 1 : 0),
        render: (u) => (
          <GTag dot tone={u.isActive ? 'ok' : 'err'} size="sm">
            {u.isActive ? 'Active' : 'Inactive'}
          </GTag>
        ),
      },
      {
        key: 'createdAt',
        label: 'Created',
        numeric: true,
        sortValue: (u) => u.createdAt,
        render: (u) => (
          <span className="text-xs text-muted-foreground tabular-nums">
            {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
          </span>
        ),
      },
      {
        key: 'actions',
        label: 'Actions',
        align: 'right',
        render: (u) => {
          const { canEdit, editReason } = getUserModifyState(u);
          const deactState = getUserDeactivateState(u);

          return (
            <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Can do="users:edit">
                <GButton
                  variant="sm"
                  onClick={() => openEditModal(u)}
                  disabled={!canEdit}
                  disabledReason={editReason}
                  title={canEdit ? 'Edit user details' : editReason}
                >
                  <Edit2 size={13} className="mr-1" />
                  Edit
                </GButton>

                {u.isActive ? (
                  <GButton
                    variant="sm"
                    onClick={() => setDeactivateConfirm({ user: u, action: 'deactivate' })}
                    disabled={!deactState.allowed}
                    disabledReason={deactState.reason}
                    title={deactState.allowed ? 'Deactivate account' : deactState.reason}
                  >
                    <UserX size={13} className="mr-1 opacity-70" />
                    Deactivate
                  </GButton>
                ) : (
                  <GButton
                    variant="sm"
                    onClick={() => setDeactivateConfirm({ user: u, action: 'activate' })}
                    disabled={!deactState.allowed}
                    disabledReason={deactState.reason}
                    title={deactState.allowed ? 'Activate account' : deactState.reason}
                  >
                    <UserCheck size={13} className="mr-1 opacity-70" />
                    Activate
                  </GButton>
                )}
              </Can>
            </div>
          );
        },
      },
    ],
    [currentUser, departmentMap, getUserModifyState, getUserDeactivateState],
  );

  return (
    <GPage>
      <GSectionHeader
        title="User Management"
        caption="Manage system accounts, assign RBAC roles, and control access permissions across departments."
        action={
          <div className="flex items-center gap-2">
            <GButton variant="default" onClick={loadData} busy={isLoading} title="Refresh user list">
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </GButton>
            <Can do="users:create">
              <GButton variant="ink" onClick={openCreateModal}>
                <Plus size={15} className="mr-1" />
                New User
              </GButton>
            </Can>
          </div>
        }
      />

      {/* Success Notification Banner */}
      {success && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="shrink-0" />
            <span>{success}</span>
          </div>
          <button
            type="button"
            className="text-xs hover:underline cursor-pointer"
            onClick={() => setSuccess(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Error Line */}
      {error && (
        <div className="mb-4">
          <GErrorLine onRetry={loadData}>{error}</GErrorLine>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <GWell className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Total Accounts</span>
            <Users size={14} className="opacity-50" />
          </div>
          <div className="text-2xl font-semibold tracking-tight">{users.length}</div>
        </GWell>

        <GWell className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Active Users</span>
            <UserCheck size={14} className="opacity-50 text-emerald-400" />
          </div>
          <div className="text-2xl font-semibold tracking-tight text-emerald-400">{activeUserCount}</div>
        </GWell>

        <GWell className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Super Admins</span>
            <ShieldAlert size={14} className="opacity-50 text-amber-400" />
          </div>
          <div className="text-2xl font-semibold tracking-tight">{activeSuperAdminCount}</div>
        </GWell>

        <GWell className="p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Your Authority</span>
            <Shield size={14} className="opacity-50 text-sky-400" />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <GTag tone={currentUser ? ROLE_TONES[currentUser.role] : 'neutral'} size="sm">
              {currentUser ? ROLE_LABELS[currentUser.role] : 'Unknown'}
            </GTag>
          </div>
        </GWell>
      </div>

      {/* Users Card & Search */}
      <GCard className="p-5">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <GInput
              size="md"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Search by name, email, department…"
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Role:</span>
            <GSelect
              size="md"
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              options={[
                { value: 'all', label: 'All Roles' },
                { value: 'super_admin', label: 'Super Admin' },
                { value: 'admin', label: 'Admin' },
                { value: 'manager', label: 'Manager' },
                { value: 'employee', label: 'Employee' },
                { value: 'viewer', label: 'Viewer' },
              ]}
            />
          </div>
        </div>

        {isLoading && users.length === 0 ? (
          <div className="space-y-3 py-4">
            <GSkeleton height={48} shape="nested" />
            <GSkeleton height={48} shape="nested" />
            <GSkeleton height={48} shape="nested" />
            <GSkeleton height={48} shape="nested" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <GEmpty
            title={users.length === 0 ? 'No user accounts found' : 'No matching users'}
            body={
              users.length === 0
                ? 'Create the first user account to get started.'
                : 'Try adjusting your search query or role filter.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <GTable
              caption="System Users"
              columns={columns}
              rows={filteredUsers}
              rowKey={(u) => u.id}
              sticky={false}
              sort={{ key: 'name', dir: 'asc' }}
            />
          </div>
        )}
      </GCard>

      {/* Create User Modal Sheet */}
      <GSheet
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setCreateError(null);
        }}
        title="Create New User"
        caption="Configure account credentials, assigned role, and department scope."
        width={540}
        footer={
          <div className="flex items-center justify-end gap-2">
            <GButton onClick={() => setCreateOpen(false)} disabled={isCreating}>
              Cancel
            </GButton>
            <GButton variant="ink" onClick={handleCreateSubmit} busy={isCreating}>
              Create User
            </GButton>
          </div>
        }
      >
        <div className="space-y-4 py-2">
          {createError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {createError}
            </div>
          )}

          <GField label="Full Name" hint="User's display name" error={!createForm.name && createError ? 'Required' : undefined}>
            <GInput
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Jane Doe"
            />
          </GField>

          <GField label="Email Address" hint="Unique login identifier">
            <GInput
              type="email"
              value={createForm.email}
              onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="jane.doe@example.com"
            />
          </GField>

          <GField
            label="Temporary Password"
            hint="Minimum 8 characters. User should rotate this upon first sign in."
          >
            <GInput
              type="password"
              value={createForm.password}
              onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="••••••••••••"
            />
          </GField>

          <GField
            label="System Role"
            hint={
              currentUser?.role === 'admin'
                ? 'Admins can assign Manager, Employee, or Viewer roles.'
                : 'Determines RBAC capabilities and permissions.'
            }
          >
            <GSelect
              value={createForm.role}
              onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as UserRole }))}
              options={assignableRoles.map((r) => ({
                value: r,
                label: ROLE_LABELS[r],
              }))}
            />
          </GField>

          <GField label="Department" hint="Optional department isolation assignment">
            <GSelect
              value={createForm.departmentId}
              onChange={(e) => setCreateForm((f) => ({ ...f, departmentId: e.target.value }))}
              options={[
                { value: '', label: 'None (Global Organization Access)' },
                ...departments.map((d) => ({
                  value: d.id,
                  label: d.name,
                })),
              ]}
            />
          </GField>
        </div>
      </GSheet>

      {/* Edit User Modal Sheet */}
      <GSheet
        open={Boolean(editUser)}
        onClose={() => {
          setEditUser(null);
          setEditError(null);
        }}
        title={`Edit User: ${editUser?.name || ''}`}
        caption="Modify user profile, role assignment, or department allocation."
        width={540}
        footer={
          <div className="flex items-center justify-end gap-2">
            <GButton onClick={() => setEditUser(null)} disabled={isUpdating}>
              Cancel
            </GButton>
            <GButton variant="ink" onClick={handleEditSubmit} busy={isUpdating}>
              Save Changes
            </GButton>
          </div>
        }
      >
        {editUser && (
          <div className="space-y-4 py-2">
            {editError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {editError}
              </div>
            )}

            <GField label="Full Name">
              <GInput
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="User name"
              />
            </GField>

            <GField label="Email Address" hint="Email address is immutable for security">
              <GInput value={editUser.email} disabled className="opacity-60 cursor-not-allowed" />
            </GField>

            {/* Role edit: restricted if actor cannot assign roles or modifying self */}
            {(() => {
              const isSelf = currentUser?.id === editUser.id;
              const isLastSuperAdmin = editUser.role === 'super_admin' && activeSuperAdminCount <= 1;
              const canEditRole =
                Boolean(currentUser) &&
                (currentUser?.role === 'super_admin' || !isSelf) &&
                assignableRoles.length > 0 &&
                !isLastSuperAdmin;

              return (
                <GField
                  label="Role"
                  hint={
                    isLastSuperAdmin
                      ? 'The only remaining active Super Admin cannot be demoted.'
                      : isSelf
                      ? 'You cannot change your own role.'
                      : !canEditRole
                      ? 'You do not have permission to modify this role.'
                      : 'Select updated role for this user.'
                  }
                >
                  <GSelect
                    value={editForm.role}
                    disabled={!canEditRole}
                    onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                    options={
                      canEditRole
                        ? assignableRoles.map((r) => ({
                            value: r,
                            label: ROLE_LABELS[r],
                          }))
                        : [{ value: editUser.role, label: ROLE_LABELS[editUser.role] }]
                    }
                  />
                </GField>
              );
            })()}

            <GField label="Department">
              <GSelect
                value={editForm.departmentId}
                onChange={(e) => setEditForm((f) => ({ ...f, departmentId: e.target.value }))}
                options={[
                  { value: '', label: 'None (Global Organization Access)' },
                  ...departments.map((d) => ({
                    value: d.id,
                    label: d.name,
                  })),
                ]}
              />
            </GField>
          </div>
        )}
      </GSheet>

      {/* Deactivate / Activate Confirmation Dialog */}
      {deactivateConfirm && (
        <GDialog
          open={Boolean(deactivateConfirm)}
          onClose={() => setDeactivateConfirm(null)}
          title={deactivateConfirm.action === 'deactivate' ? 'Deactivate User Account' : 'Activate User Account'}
          confirmLabel={deactivateConfirm.action === 'deactivate' ? 'Deactivate Account' : 'Activate Account'}
          tone={deactivateConfirm.action === 'deactivate' ? 'danger' : 'default'}
          busy={isDeactivating}
          onConfirm={handleToggleActiveSubmit}
        >
          <div className="text-sm space-y-2">
            <p>
              Are you sure you want to {deactivateConfirm.action} the account for{' '}
              <strong className="text-foreground">{deactivateConfirm.user.name}</strong> (
              <span className="text-muted-foreground">{deactivateConfirm.user.email}</span>)?
            </p>
            {deactivateConfirm.action === 'deactivate' && (
              <p className="text-xs text-amber-400 bg-amber-400/10 p-2.5 rounded-lg border border-amber-400/20">
                Warning: Deactivating this account will immediately revoke all active sessions, API tokens, and
                system access for this user.
              </p>
            )}
          </div>
        </GDialog>
      )}
    </GPage>
  );
}
