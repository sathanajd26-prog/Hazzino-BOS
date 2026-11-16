import { Suspense } from 'react';
import Link from 'next/link';
import { isAuthConfigured } from '@/lib/auth/guard';
import { LoginForm } from '@/components/LoginForm';
import { BRAND } from '@/lib/brand';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';
import { LoginFormG, NoPasswordG } from '@/components/login/LoginG';
import { LoginFormL, NoPasswordL } from '@/components/login/LoginL';

export const dynamic = 'force-dynamic';

/**
 * The login page reachable without a session.
 *
 * When no administrative user exists, prompts the operator to run
 * `npm run bootstrap:admin` on the host rather than showing an unauthenticated form.
 */
export default function LoginPage() {
  const configured = isAuthConfigured();
  const tree = treeFor(getAppearance(), '/login');

  if (tree === 'glados') {
    if (!configured) return <NoPasswordG brandName={BRAND.name} mark={BRAND.mark} />;
    return (
      <Suspense fallback={null}>
        <LoginFormG brandName={BRAND.name} mark={BRAND.mark} />
      </Suspense>
    );
  }

  if (tree === 'legacy') {
    if (!configured) return <NoPasswordL brandName={BRAND.name} />;
    return (
      <Suspense fallback={null}>
        <LoginFormL brandName={BRAND.name} />
      </Suspense>
    );
  }

  if (!configured) {
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <div className="w-full max-w-[340px]">
          <div className="mb-1 flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />
            <span className="text-[15px] font-medium">{BRAND.name}</span>
          </div>
          <p className="mb-5 text-[12.5px] text-os-dim">Setup required on this install</p>
          <p className="text-[12.5px] leading-relaxed text-os-dim">
            No administrative account has been created yet. Run the bootstrap utility on the host machine to provision the initial Super Admin:
          </p>
          <div className="my-4 rounded bg-os-surface/80 p-2 font-mono text-[12px] text-os-text border border-os-border">
            npm run bootstrap:admin
          </div>
          <div className="mt-5 flex gap-2.5">
            <Link href="/" className="c-btn c-btn-primary justify-center px-3.5 py-2 text-[13px]">
              Open {BRAND.name}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="grid min-h-[70vh] place-items-center text-[12.5px] text-os-dim">Loading…</div>}>
      <LoginForm brandName={BRAND.name} />
    </Suspense>
  );
}
