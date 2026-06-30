import { useState, type FormEvent } from 'react';
import { useLoginWithEmail } from '@privy-io/react-auth';
import { useAuthContext } from '../hooks/AuthContext';
import './Landing.css';

/**
 * Logged-out dashboard screen, aligned with the /chat CcAuth login.
 *
 * Two-column hero + Privy card. The email path uses Privy's headless
 * `useLoginWithEmail()` (the dashboard is on the same Privy 3.18 as chat and the
 * provider enables the `email` login method with an embedded Solana wallet), so
 * the user enters one email, gets a 6-digit OTP, and verifies inline. Wallet
 * sign-in falls back to the Privy modal via `login()`.
 *
 * The dashboard-only API-key login (`loginWithApiKey`, `clk_…` + optional custom
 * endpoint) is preserved as a secondary "Advanced" option so nothing regresses.
 * On success Privy authenticates, useAuth() auto-registers a `clk_` key, and
 * App.tsx swaps this screen for the signed-in dashboard.
 */
export function Landing() {
  const { login, loginWithApiKey } = useAuthContext();
  const { sendCode, loginWithCode, state } = useLoginWithEmail();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  // Dashboard-only API-key login (secondary).
  const [apiKey, setApiKey] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [connecting, setConnecting] = useState(false);

  const statusName: string = (state as { status?: string } | undefined)?.status ?? 'initial';
  const sendingCode = statusName === 'sending-code' || pending;
  const submittingCode = statusName === 'submitting-code';

  async function handleSendCode(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || sendingCode) return;
    setError('');
    setPending(true);
    try {
      await sendCode({ email: trimmed });
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code. Try again.');
    } finally {
      setPending(false);
    }
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length < 4 || submittingCode || pending) return;
    setError('');
    setPending(true);
    try {
      await loginWithCode({ code: trimmed });
      // Privy authenticates -> useAuth() auto-registers clk_ -> App swaps to the dashboard.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code. Check your inbox and try again.');
    } finally {
      setPending(false);
    }
  }

  async function handleResend() {
    if (!email.trim() || sendingCode) return;
    setCode('');
    setError('');
    try {
      await sendCode({ email: email.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code.');
    }
  }

  async function handleApiKeyLogin() {
    if (!apiKey.trim() || connecting) return;
    setError('');
    setConnecting(true);
    const valid = await loginWithApiKey(apiKey.trim(), endpoint.trim() || undefined);
    if (!valid) setError('Invalid API key or endpoint unreachable.');
    setConnecting(false);
  }

  return (
    <div className="dlogin">
      {/* ── hero ── */}
      <section className="dlogin__hero">
        <div className="dlogin__top">
          <div className="dlogin__wordmark">
            <span className="dlogin__mark">CLUDE</span>
            <span className="dlogin__badge">Dashboard</span>
          </div>
          <span className="dlogin__tag"><span className="dlogin__dot" />◎ Memory online</span>
        </div>

        <div className="dlogin__lede">
          <div className="dlogin__eyebrow">◈ Cognitive memory, visualized</div>
          <h1 className="dlogin__h1">
            See what your agent <span className="dlogin__h1-em">remembers.</span>
          </h1>
          <p>
            Sign in to explore your agent's memory: walk the timeline and entity graph,
            search and export packs, and carry knowledge across agents. Typed, decay-aware,
            and portable.
          </p>
        </div>
      </section>

      {/* ── form ── */}
      <section className="dlogin__form">
        <div className="dlogin__formhead">
          <span className="dlogin__privy">◉ auth by <strong>PRIVY</strong></span>
          <span className="dlogin__tag">◎ non-custodial</span>
        </div>

        <div className="dlogin__card">
          <div>
            <h2 className="dlogin__title">{step === 'code' ? 'Check your inbox.' : 'Welcome back.'}</h2>
            <p className="dlogin__desc">
              {step === 'code'
                ? `We sent a 6-digit code to ${email}. Enter it below to continue.`
                : 'Sign in with a one-time code or your wallet. Your memories are waiting, typed and ready to recall.'}
            </p>
          </div>

          {step === 'email' ? (
            <form onSubmit={handleSendCode} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="dlogin__field">
                <label className="dlogin__label">Email</label>
                <input
                  className="dlogin__input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@domain.dev"
                  autoFocus
                  required
                />
              </div>
              <button className="dlogin__primary" type="submit" disabled={sendingCode || !email.trim()}>
                {sendingCode ? (
                  <><span className="dlogin__spinner" /> sending code…</>
                ) : (
                  <>Send one-time code <span>→</span></>
                )}
              </button>
              <div className="dlogin__divider">or</div>
              <button type="button" className="dlogin__primary dlogin__ghost" onClick={() => login()}>
                Sign in with wallet <span>→</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="dlogin__field">
                <label className="dlogin__label">6-digit code</label>
                <input
                  className="dlogin__input dlogin__input--code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder="123456"
                  autoFocus
                  required
                />
              </div>
              <button className="dlogin__primary" type="submit" disabled={pending || submittingCode || code.length < 4}>
                {pending || submittingCode ? (
                  <><span className="dlogin__spinner" /> verifying…</>
                ) : (
                  <>Continue <span>→</span></>
                )}
              </button>
              <div className="dlogin__inlinebtns">
                <button
                  type="button"
                  className="dlogin__link"
                  onClick={() => { setCode(''); setError(''); setStep('email'); }}
                >
                  ← Change email
                </button>
                <button type="button" className="dlogin__link" onClick={handleResend}>↺ Resend code</button>
              </div>
            </form>
          )}

          {error && <div className="dlogin__err">{error}</div>}

          {/* API-key login — dashboard-only, kept as a secondary option. */}
          <details className="dlogin__adv">
            <summary>Use an API key (clk_…)</summary>
            <div className="dlogin__advbody">
              <div className="dlogin__row">
                <input
                  className="dlogin__input"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="clk_…"
                  onKeyDown={(e) => e.key === 'Enter' && handleApiKeyLogin()}
                />
                <button className="dlogin__go" onClick={handleApiKeyLogin} disabled={!apiKey.trim() || connecting}>
                  {connecting ? '…' : 'Go'}
                </button>
              </div>
              <input
                className="dlogin__input"
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://clude.io (custom endpoint, optional)"
                onKeyDown={(e) => e.key === 'Enter' && handleApiKeyLogin()}
                style={{ fontSize: 12 }}
              />
            </div>
          </details>

          <div className="dlogin__legal">
            By continuing you agree to the <a href="https://clude.io" target="_blank" rel="noreferrer">Terms</a> and{' '}
            <a href="https://clude.io" target="_blank" rel="noreferrer">Privacy Policy</a>. Memory is portable, export anytime.
          </div>
        </div>
      </section>
    </div>
  );
}
