'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { OsMark, Pressable } from '@/components/legacy';
import { useLogin } from '@/components/LoginForm';

function Frame({ brandName, title, children }: { brandName: string; title: string; children: ReactNode }) {
  const [host, setHost] = useState('');
  useEffect(() => setHost(window.location.host), []);
  return (
    <main data-l="Login" className="l-login">
      <div className="l-login-head l-rise">
        <OsMark size={40} />
        <div className="l-eyebrow">{'// ENTERPRISE ACCESS'}</div>
        <h1 className="l-login-title">{title}</h1>
      </div>
      <section data-l="SlabCard" className="l-card l-login-card l-rise" aria-label={`${brandName} sign in`}>
        {children}
      </section>
      <p className="l-login-foot">
        {brandName}
        {host ? ` · ${host}` : ''}
      </p>
    </main>
  );
}

export function LoginFormL({ brandName }: { brandName: string }) {
  const { email, setEmail, password, setPassword, error, busy, submit } = useLogin();
  return (
    <Frame brandName={brandName} title="Sign in">
      <form onSubmit={submit} className="l-login-form">
        <label htmlFor="login-email" className="l-login-label">
          Work Email
        </label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="operator@hazzino.com"
          autoFocus
          autoComplete="username"
          className="l-login-input"
        />

        <label htmlFor="login-password" className="l-login-label" style={{ marginTop: 12 }}>
          Password
        </label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          aria-invalid={Boolean(error)}
          className="l-login-input"
        />

        <Pressable
          tone="primary"
          type="submit"
          disabled={busy || password.length === 0}
          className="l-login-submit"
          title={password.length === 0 ? 'Type the password first' : undefined}
        >
          {busy ? 'Signing in' : 'Sign in'} <ArrowRight size={13} strokeWidth={2} aria-hidden />
        </Pressable>
        {error && (
          <p role="alert" className="l-login-error">
            {error}
          </p>
        )}
      </form>
      <p className="l-login-note">
        Hazzino BOS Enterprise Security. To provision accounts, run the administrative bootstrap on the host.
      </p>
    </Frame>
  );
}

export function NoPasswordL({ brandName }: { brandName: string }) {
  return (
    <Frame brandName={brandName} title="Setup Required">
      <p className="l-login-note">
        No administrator account has been provisioned yet. Bootstrap the initial Super Admin:
      </p>
      <div className="mt-2 mb-3 rounded bg-os-surface/80 p-2 font-mono text-[12px] text-os-text border border-os-border">
        npm run bootstrap:admin
      </div>
      <div className="l-login-actions">
        <Pressable tone="primary" href="/">
          Open {brandName}
        </Pressable>
      </div>
    </Frame>
  );
}
