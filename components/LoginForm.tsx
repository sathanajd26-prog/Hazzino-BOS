'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** The sign-in form itself. Rendered when authentication is configured. */
export function LoginForm({ brandName }: { brandName: string }) {
  const { email, setEmail, password, setPassword, error, busy, submit } = useLogin();
  return <LoginClassic {...{ brandName, email, setEmail, password, setPassword, error, busy, submit }} />;
}

/** Sign-in state and submit, shared by both trees of /login. */
export function useLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: { email?: string; password: string } = { password };
      if (email.trim()) {
        payload.email = email.trim();
      }

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const nextParam = params.get('next');
        const destination =
          nextParam &&
          nextParam.startsWith('/') &&
          !nextParam.startsWith('//') &&
          !nextParam.startsWith('/\\') &&
          !nextParam.split('?')[0].includes(':')
            ? nextParam
            : '/';
        router.replace(destination);
        router.refresh();
        return;
      }

      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Invalid email or password.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return { email, setEmail, password, setPassword, error, busy, submit };
}

function LoginClassic({
  brandName,
  email,
  setEmail,
  password,
  setPassword,
  error,
  busy,
  submit,
}: ReturnType<typeof useLogin> & { brandName: string }) {
  return (
    <div className="grid min-h-[70vh] place-items-center">
      <form onSubmit={submit} className="w-full max-w-[340px]">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />
          <span className="text-[15px] font-medium">{brandName}</span>
        </div>
        <p className="mb-5 text-[12.5px] text-os-dim">Enterprise sign in · enter your credentials</p>

        <div className="space-y-3">
          <div>
            <label className="block mb-1 text-[11px] font-medium uppercase tracking-wider text-os-dim">
              Work Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@hazzino.com"
              autoFocus
              autoComplete="username"
              className="w-full rounded-[9px] border border-os-border bg-os-surface px-3.5 py-2.5 text-[13px] text-os-text outline-none transition-colors focus:border-[var(--accent-line)]"
              style={{ caretColor: 'var(--accent)' }}
            />
          </div>

          <div>
            <label className="block mb-1 text-[11px] font-medium uppercase tracking-wider text-os-dim">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              className="w-full rounded-[9px] border border-os-border bg-os-surface px-3.5 py-2.5 text-[13px] text-os-text outline-none transition-colors focus:border-[var(--accent-line)]"
              style={{ caretColor: 'var(--accent)' }}
            />
          </div>
        </div>

        {error && (
          <div className="mt-3 flex items-center gap-2 text-[12px]" style={{ color: 'var(--err)' }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--err)' }} />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="c-btn c-btn-primary mt-4 w-full justify-center py-2.5 text-[13px] disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="mt-5 text-[11px] leading-relaxed text-os-dim">
          Hazzino Business Operating System. For employee account provisioning or password resets, contact your system administrator.
        </p>
      </form>
    </div>
  );
}
