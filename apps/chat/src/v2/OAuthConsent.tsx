import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePrivy, useLoginWithEmail } from '@privy-io/react-auth';
import { CcWordmark } from './atoms';

/**
 * OAuth 2.1 consent screen for the MCP connector (served at /chat/authorize).
 *
 * Claude redirects the browser here (via the server's GET /api/oauth/authorize, which has
 * already validated client_id + redirect_uri). The user signs in with Privy (email OTP or
 * wallet) — no API key — then approves. We hand the Privy access token to
 * POST /api/oauth/authorize/complete, which maps the Privy DID -> owner_wallet and mints a
 * single-use authorization code, then we bounce the browser back to Claude with that code.
 */
export function OAuthConsent() {
  const [params] = useSearchParams();
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();

  const oauth = {
    client_id: params.get('client_id') ?? '',
    redirect_uri: params.get('redirect_uri') ?? '',
    code_challenge: params.get('code_challenge') ?? '',
    code_challenge_method: params.get('code_challenge_method') ?? 'S256',
    scope: params.get('scope') ?? 'memory:read memory:write',
    state: params.get('state') ?? '',
  };
  const invalid = !oauth.client_id || !oauth.redirect_uri || !oauth.code_challenge;

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canWrite = oauth.scope.split(' ').includes('memory:write');

  const sendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || pending) return;
    setError(null);
    setPending(true);
    try {
      await sendCode({ email: trimmed });
      setStep('code');
    } catch (err: any) {
      setError(err?.message || 'Could not send code. Try again.');
    } finally {
      setPending(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length < 4 || pending) return;
    setError(null);
    setPending(true);
    try {
      await loginWithCode({ code: trimmed });
      // Privy flips `authenticated` → the consent panel renders below.
    } catch (err: any) {
      setError(err?.message || 'Invalid code. Check your inbox and try again.');
    } finally {
      setPending(false);
    }
  };

  const approve = async () => {
    setPending(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('No active session token.');
      const res = await fetch('/api/oauth/authorize/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privy_token: token, ...oauth }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.redirect_to) {
        throw new Error(data.error_description || data.error || 'Authorization failed.');
      }
      window.location.href = data.redirect_to;
    } catch (err: any) {
      setError(err?.message || 'Authorization failed.');
      setPending(false);
    }
  };

  const card = (children: React.ReactNode) => (
    <div className="cc-app" data-theme="dark">
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div className="cc-auth__card" style={{ maxWidth: 440, width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <CcWordmark badge="Connect" />
            <span className="cc-auth__privy">◉ auth by <strong>PRIVY</strong></span>
          </div>
          {children}
          {error && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--clude-danger)' }}>
              {error}
            </div>
          )}
          <div className="cc-auth__legal">
            Clude stores only what you choose to save and keeps it private to your account. It does
            not read your Claude chat history.
          </div>
        </div>
      </div>
    </div>
  );

  if (invalid) {
    return card(
      <div>
        <h2 className="cc-auth__title">Invalid request</h2>
        <p className="cc-auth__desc">
          This authorization link is missing required parameters. Start the connection again from
          Claude.
        </p>
      </div>,
    );
  }

  if (!ready) {
    return card(
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--fg-3)' }}>
        <span className="cc-spinner" /> Loading…
      </div>,
    );
  }

  if (denied) {
    return card(
      <div>
        <h2 className="cc-auth__title">Access not granted</h2>
        <p className="cc-auth__desc">You declined the connection. You can close this window.</p>
      </div>,
    );
  }

  // Signed in → show the consent panel.
  if (authenticated) {
    return card(
      <>
        <div>
          <h2 className="cc-auth__title">Connect Clude to Claude</h2>
          <p className="cc-auth__desc">
            Claude is requesting access to your Clude memory. After you allow, Claude can:
          </p>
          <ul style={{ margin: '12px 0', paddingLeft: 18, color: 'var(--fg-2)', fontSize: 13, lineHeight: 1.7 }}>
            <li>Recall memories you've saved (read)</li>
            {canWrite && <li>Save new memories on your behalf (write)</li>}
          </ul>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button type="button" className="cc-auth__primary" disabled={pending} onClick={approve}>
            {pending ? (
              <><span className="cc-spinner" /> connecting…</>
            ) : (
              <>Allow <span className="cc-arrow">→</span></>
            )}
          </button>
          <button
            type="button"
            className="cc-auth__primary"
            style={{ background: 'transparent', color: 'var(--fg-2)', borderColor: 'var(--line-strong)' }}
            disabled={pending}
            onClick={() => setDenied(true)}
          >
            Deny
          </button>
        </div>
      </>,
    );
  }

  // Signed out → email OTP (wallet as fallback).
  if (step === 'email') {
    return card(
      <form onSubmit={sendOtp} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <h2 className="cc-auth__title">Sign in to continue</h2>
          <p className="cc-auth__desc">
            Enter your email to connect Claude to your Clude memory. New here? An account is created
            automatically.
          </p>
        </div>
        <div className="cc-auth__field">
          <label className="cc-auth__label">Email</label>
          <input
            className="cc-auth__input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@domain.dev"
            autoFocus
            required
          />
        </div>
        <button className="cc-auth__primary" type="submit" disabled={pending || !email.trim()}>
          {pending ? (
            <><span className="cc-spinner" /> sending code…</>
          ) : (
            <>Send one-time code <span className="cc-arrow">→</span></>
          )}
        </button>
        <div className="cc-auth__divider">or</div>
        <button
          type="button"
          className="cc-auth__primary"
          style={{ background: 'transparent', color: 'var(--fg-1)', borderColor: 'var(--line-strong)' }}
          onClick={() => login()}
        >
          Sign in with wallet <span className="cc-arrow">→</span>
        </button>
      </form>,
    );
  }

  return card(
    <form onSubmit={verifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h2 className="cc-auth__title">Check your inbox</h2>
        <p className="cc-auth__desc">We sent a 6-digit code to {email}. Enter it below to continue.</p>
      </div>
      <div className="cc-auth__field">
        <label className="cc-auth__label">6-digit code</label>
        <input
          className="cc-auth__input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
          placeholder="123456"
          autoFocus
          required
          style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.3em', textAlign: 'center', fontSize: 20 }}
        />
      </div>
      <button className="cc-auth__primary" type="submit" disabled={pending || code.length < 4}>
        {pending ? (
          <><span className="cc-spinner" /> verifying…</>
        ) : (
          <>Continue <span className="cc-arrow">→</span></>
        )}
      </button>
      <button
        type="button"
        className="cc-auth__magic__resend"
        onClick={() => { setCode(''); setError(null); setStep('email'); }}
      >
        ← Change email
      </button>
    </form>,
  );
}
