import { useEffect, useState } from 'react';
import { useAuthContext } from '../hooks/AuthContext';
import { CcAuth } from './CcAuth';
import { CcChat } from './CcChat';
import './styles/colors_and_type.css';
import './styles/chat-styles.css';
import type { V2Theme } from './types';

const THEME_KEY = 'v2_theme';
// Session-scoped gate. Each new browser session (new tab / window / incognito /
// link share) lands on the auth screen first, even if the user is already
// signed in via the main /chat route. Once they explicitly enter (OTP success,
// wallet connect, or "Continue" for already-signed-in sessions) the flag
// sticks through page refreshes for the remainder of the session.
const ENTERED_KEY = 'v2_entered';

/**
 * Clude Chat v2 — top-level route.
 * Mounted at `/chat/v2`. Keeps existing Privy/Solana auth; the design's
 * magic-link screen becomes a visual layer that calls `auth.login()`.
 */
export function V2App() {
  const auth = useAuthContext();
  const [theme, setThemeState] = useState<V2Theme>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
    return saved === 'dark' ? 'dark' : 'light';
  });

  const setTheme = (t: V2Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  };

  const [hasEntered, setHasEntered] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return sessionStorage.getItem(ENTERED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const markEntered = () => {
    try {
      sessionStorage.setItem(ENTERED_KEY, 'true');
    } catch {}
    setHasEntered(true);
  };

  // If the user signs out from inside the chat surface, reset the gate so a
  // subsequent login lands them on the auth screen again.
  useEffect(() => {
    if (!auth.authenticated && hasEntered) {
      try {
        sessionStorage.removeItem(ENTERED_KEY);
      } catch {}
      setHasEntered(false);
    }
  }, [auth.authenticated, hasEntered]);

  // Remove the dark-mode .dark class the existing /chat route adds to <html>,
  // so our data-theme-driven vars are the source of truth on /v2.
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.classList.contains('dark');
    html.classList.remove('dark');
    return () => {
      if (prev) html.classList.add('dark');
    };
  }, []);

  if (!auth.ready) {
    return (
      <div
        className="cc-app"
        data-theme={theme}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--bg-1)',
          color: 'var(--fg-3)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
        }}
      >
        CLUDE · loading
      </div>
    );
  }

  // Always show the auth screen first on a fresh session — this is the v2
  // product entry, not a shortcut into the main /chat session state.
  if (!hasEntered || !auth.authenticated) {
    return <CcAuth theme={theme} onEntered={markEntered} />;
  }

  return <CcChat theme={theme} setTheme={setTheme} />;
}
