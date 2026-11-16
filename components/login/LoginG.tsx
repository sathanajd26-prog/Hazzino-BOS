'use client';

/* eslint-disable @next/next/no-img-element */
import { GButton, GCard, GField, GInput } from '@/components/g';
import { useLogin } from '@/components/LoginForm';

function Frame({ brandName, mark, children }: { brandName: string; mark: string; children: React.ReactNode }) {
  return (
    <div data-g="GPage" className="g-page kg-login">
      <div className="page-ground g-ground" aria-hidden />
      <GCard p={24} as="section" className="kg-login-card" aria-label={`${brandName} sign in`}>
        <div className="kg-login-brand">
          <img src={mark} alt="" width={28} height={21} className="kg-login-mark" />
          <span>{brandName}</span>
        </div>
        {children}
      </GCard>
    </div>
  );
}

export function LoginFormG({ brandName, mark }: { brandName: string; mark: string }) {
  const { email, setEmail, password, setPassword, error, busy, submit } = useLogin();
  return (
    <Frame brandName={brandName} mark={mark}>
      <h1 className="kg-login-title">Sign in</h1>
      <p className="kg-cap">{brandName} · enter your employee credentials</p>
      <form onSubmit={submit} className="kg-login-form">
        <GField label="Work Email" htmlFor="login-email">
          <GInput
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="operator@hazzino.com"
            autoFocus
            autoComplete="username"
          />
        </GField>
        <GField label="Password" htmlFor="login-password" error={error ?? undefined}>
          <GInput
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            invalid={Boolean(error)}
          />
        </GField>
        <GButton
          type="submit"
          variant="ink"
          busy={busy}
          disabled={password.length === 0}
          disabledReason="Type the password first"
          className="kg-login-submit"
        >
          Sign in
        </GButton>
      </form>
      <p className="kg-cap">
        Hazzino BOS Enterprise Security. To provision accounts or reset passwords, use the administrative bootstrap or contact a system administrator.
      </p>
    </Frame>
  );
}

export function NoPasswordG({ brandName, mark }: { brandName: string; mark: string }) {
  return (
    <Frame brandName={brandName} mark={mark}>
      <h1 className="kg-login-title">System Setup Required</h1>
      <p className="kg-body">
        No administrative user has been provisioned on this install yet. Bootstrap the first Super Admin using the CLI command:
      </p>
      <div className="mt-3 mb-4 rounded bg-os-surface/80 p-2 font-mono text-[12px] text-os-text border border-os-border">
        npm run bootstrap:admin
      </div>
      <div className="kg-setting-actions">
        <GButton variant="ink" href="/">
          Open {brandName}
        </GButton>
      </div>
    </Frame>
  );
}
