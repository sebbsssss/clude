import { useEffect, useRef, useState } from 'react';
import { useLoginWithEmail } from '@privy-io/react-auth';
import { useAuthContext } from '../hooks/AuthContext';
import { CcWordmark } from './atoms';

/**
 * Logged-out screen.
 *
 * The design mocked an email magic-link flow; we wire it to Privy's headless
 * `useLoginWithEmail()` so the user enters their email once in our form,
 * Privy delivers a 6-digit OTP to their inbox, and they enter it inline —
 * no second Privy modal, no double email entry.
 *
 * Wallet sign-in falls back to the generic Privy modal (`login()`) since
 * wallet pairing can't be headless the same way.
 */
export function CcAuth({
  theme,
  onEntered,
}: {
  theme: 'light' | 'dark';
  onEntered?: () => void;
}) {
  const auth = useAuthContext();
  const { login } = auth;
  const { sendCode, loginWithCode, state } = useLoginWithEmail();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Local card step — lets the user go back to "change email" even though
  // Privy's OtpFlowState is still `awaiting-code-input`.
  const [step, setStep] = useState<'email' | 'code'>('email');

  // Auto-enter the app when auth transitions from signed-out → signed-in
  // (e.g. after OTP verification or wallet-modal connection). We explicitly
  // skip the initial render — a user who was already signed in from the
  // main /chat route should still see the auth screen and click Continue.
  const prevAuthRef = useRef<boolean>(auth.authenticated);
  useEffect(() => {
    if (auth.authenticated && !prevAuthRef.current && onEntered) {
      onEntered();
    }
    prevAuthRef.current = auth.authenticated;
  }, [auth.authenticated, onEntered]);

  // Privy's OtpFlowState status used to disable buttons while in-flight.
  const statusName: string = (state as any)?.status ?? 'initial';
  const sendingCode = statusName === 'sending-code' || pending;
  const submittingCode = statusName === 'submitting-code';

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || sendingCode) return;
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

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || trimmed.length < 4) return;
    setError(null);
    setPending(true);
    try {
      await loginWithCode({ code: trimmed });
      // Auth resolves through Privy → useAuth() → V2App switches to CcChat.
    } catch (err: any) {
      setError(err?.message || 'Invalid code. Check your inbox and try again.');
    } finally {
      setPending(false);
    }
  };

  const handleResend = async () => {
    if (!email.trim() || sendingCode) return;
    setCode('');
    setError(null);
    try {
      await sendCode({ email: email.trim() });
    } catch (err: any) {
      setError(err?.message || 'Could not resend code.');
    }
  };

  return (
    <div className="cc-app" data-theme={theme}>
      <div className="cc-auth">
        <section className="cc-auth__hero">
          <div className="cc-auth__top">
            <CcWordmark badge="Chat" />
            <span className="cc-auth__tag">
              <span className="cc-auth__tag__dot" />◎ Memory online · v2
            </span>
          </div>

          <div className="cc-auth__lede">
            <div className="cc-auth__eyebrow">◈ Cognitive memory for chat</div>
            <h1 className="cc-auth__h1">
              Chat that <span className="cc-auth__h1-em">remembers</span> — not just stores.
            </h1>
            <p>
              Every model on your terms. Every conversation on your memory. Typed,
              decay‑aware, portable across agents — and{' '}
              <strong style={{ color: 'var(--fg-1)', fontWeight: 600 }}>
                1.96% hallucination
              </strong>{' '}
              on HaluMem vs. 15.2% next best.
            </p>
          </div>

          <div className="cc-auth__stats">
            <div className="cc-auth__stat">
              <div className="cc-auth__stat__v cc-auth__stat__v--brand">1.96%</div>
              <div className="cc-auth__stat__k">halu · halumem</div>
            </div>
            <div className="cc-auth__stat">
              <div className="cc-auth__stat__v cc-auth__stat__v--good">−78%</div>
              <div className="cc-auth__stat__k">tok vs frontier</div>
            </div>
            <div className="cc-auth__stat">
              <div className="cc-auth__stat__v">8</div>
              <div className="cc-auth__stat__k">models · swap live</div>
            </div>
          </div>
        </section>

        <section className="cc-auth__form">
          <div className="cc-auth__formhead">
            <span className="cc-auth__privy">
              ◉ auth by <strong>PRIVY</strong>
            </span>
            <div className="cc-auth__switch">
              <button
                type="button"
                className={`cc-auth__switchbtn ${mode === 'login' ? 'is-active' : ''}`}
                onClick={() => setMode('login')}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`cc-auth__switchbtn ${mode === 'register' ? 'is-active' : ''}`}
                onClick={() => setMode('register')}
              >
                Create account
              </button>
            </div>
          </div>

          <div className="cc-auth__card">
            <div>
              <h2 className="cc-auth__title">
                {auth.authenticated
                  ? 'Welcome back.'
                  : step === 'code'
                  ? 'Check your inbox.'
                  : mode === 'login'
                  ? 'Welcome back.'
                  : 'Start your memory.'}
              </h2>
              <p className="cc-auth__desc">
                {auth.authenticated
                  ? 'Your session is active — continue into Clude Chat v2.'
                  : step === 'code'
                  ? `We sent a 6‑digit code to ${email}. Enter it below to continue.`
                  : mode === 'login'
                  ? 'Sign in with a one‑time code or wallet. Your memories are waiting — typed, decayed, and ready to recall.'
                  : 'One email is all we need. Your memory starts fresh — yours, portable, never shared.'}
              </p>
            </div>

            {auth.authenticated ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <button
                  type="button"
                  className="cc-auth__primary"
                  onClick={() => onEntered?.()}
                >
                  Continue to Chat <span className="cc-arrow">→</span>
                </button>
                <button
                  type="button"
                  className="cc-auth__primary"
                  style={{
                    background: 'transparent',
                    color: 'var(--fg-2)',
                    borderColor: 'var(--line-strong)',
                  }}
                  onClick={() => auth.logout()}
                >
                  Sign out
                </button>
              </div>
            ) : step === 'email' ? (
              <form onSubmit={handleSendCode} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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
                <button className="cc-auth__primary" type="submit" disabled={sendingCode || !email.trim()}>
                  {sendingCode ? (
                    <>
                      <span className="cc-spinner" /> sending code…
                    </>
                  ) : (
                    <>
                      {mode === 'login' ? 'Send one-time code' : 'Create account'}{' '}
                      <span className="cc-arrow">→</span>
                    </>
                  )}
                </button>
                <div className="cc-auth__divider">or</div>
                <button
                  type="button"
                  className="cc-auth__primary"
                  style={{
                    background: 'transparent',
                    color: 'var(--fg-1)',
                    borderColor: 'var(--line-strong)',
                  }}
                  onClick={() => login()}
                >
                  Sign in with wallet <span className="cc-arrow">→</span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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
                <button
                  className="cc-auth__primary"
                  type="submit"
                  disabled={pending || submittingCode || code.length < 4}
                >
                  {pending || submittingCode ? (
                    <>
                      <span className="cc-spinner" /> verifying…
                    </>
                  ) : (
                    <>
                      Continue <span className="cc-arrow">→</span>
                    </>
                  )}
                </button>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14 }}>
                  <button
                    type="button"
                    className="cc-auth__magic__resend"
                    onClick={() => {
                      setCode('');
                      setError(null);
                      setStep('email');
                    }}
                  >
                    ← Change email
                  </button>
                  <button type="button" className="cc-auth__magic__resend" onClick={handleResend}>
                    ↺ Resend code
                  </button>
                </div>
              </form>
            )}

            {error && (
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--clude-danger)',
                  marginTop: -8,
                }}
              >
                {error}
              </div>
            )}

            <div className="cc-auth__legal">
              By continuing you agree to the <a href="/">Terms</a> and{' '}
              <a href="/">Privacy Policy</a>. Memory is local‑first and portable — export
              anytime.
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--fg-3)',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              marginTop: 32,
            }}
          >
            <span>◇ v2 · benchmarks ↗</span>
            <span>◎ clude.io</span>
          </div>
        </section>
      </div>
    </div>
  );
}
