'use client';

import React from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { GEmpty } from '@/components/g';
import { useUiStyle } from '@/lib/use-ui-style';
import type { UiStyle } from '@/lib/appearance';

export interface AccessDeniedProps {
  pathname?: string;
  requiredPermission?: string | null;
  userRole?: string | null;
  ui?: UiStyle;
}

export function AccessDenied({ pathname, requiredPermission, userRole, ui = 'classic' }: AccessDeniedProps) {
  const g = useUiStyle(ui) === 'glados';

  const title = '403 Forbidden — Access Denied';
  const detail = requiredPermission ? ` (requires "${requiredPermission}")` : '';
  const body = `You do not have permission to access ${pathname || 'this section'}${detail}. Your current role is "${userRole || 'unassigned'}". Contact your administrator if you need access.`;

  if (g) {
    return (
      <div className="py-12" role="alert">
        <GEmpty
          title={title}
          body={body}
          action={{ label: 'Return to Dashboard', href: '/' }}
        />
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="mx-auto mt-16 max-w-[480px] rounded-lg-t border border-os-border bg-os-surface px-6 py-8 text-center shadow-sm"
    >
      <div className="mx-auto mb-3.5 flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-500">
        <ShieldAlert className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h1 className="text-[15px] font-semibold text-os-text">{title}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-os-muted">
        You do not have permission to view this section
        {requiredPermission && <span className="font-mono text-os-text"> ({requiredPermission})</span>}.
      </p>
      <p className="mt-1 text-[12px] text-os-dim">
        Your assigned role is <span className="font-mono font-medium text-os-text">{userRole ?? 'unassigned'}</span>.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link href="/" className="c-btn c-btn-primary inline-flex px-4 py-2 text-[13px]">
          Return to Dashboard
        </Link>
        <Link href="/login" className="c-btn inline-flex border border-os-border bg-os-surface2 px-4 py-2 text-[13px] text-os-dim hover:text-os-text">
          Switch Account
        </Link>
      </div>
    </div>
  );
}
