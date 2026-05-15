import { useEffect, useState } from 'react';
import { useAuthContext } from '../hooks/AuthContext';
import { useMemory } from '../hooks/useMemory';
import { CcAuth } from './CcAuth';
import { CcChat } from './CcChat';
import { CcOnboarding } from './CcOnboarding';
import './styles/colors_and_type.css';
import './styles/chat-styles.css';
import type { V2Theme } from './types';

const THEME_KEY = 'v2_theme';
// Session-scoped gate. Each new browser session (new tab / window / incognito /
// link share) lands on the auth screen first. Once they explicitly enter
// (OTP success, wallet connect, or "Continue" for already-signed-in sessions)
// the flag sticks through page refreshes for the remainder of the session.
const ENTERED_KEY = 'v2_entered';
// Persistent across sessions. Set when the user finishes onboarding (any path,
// including "just start chatting"). Returning users skip onboarding entirely.
const ONBOARDED_KEY = 'v2_onboarded';

/**
 * Clude Chat — top-level route at /chat/. Keeps Privy/Solana auth; the
 * magic-link screen is a visual layer that calls `auth.login()`.
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

  // Always show the auth screen first on a fresh session — this is the
  // product entry, not a shortcut into an existing session.
  if (!hasEntered || !auth.authenticated) {
    return <CcAuth theme={theme} onEntered={markEntered} />;
  }

  return <PostAuthRouter theme={theme} setTheme={setTheme} />;
}

/**
 * Decides between onboarding and chat once the user is past auth. Pulled out
 * so `useMemory()` only mounts after authentication — its API calls assume
 * an authenticated session and would 401 otherwise.
 */
function PostAuthRouter({
  theme,
  setTheme,
}: {
  theme: V2Theme;
  setTheme: (t: V2Theme) => void;
}) {
  const memHook = useMemory();
  const [flagged, setFlagged] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(ONBOARDED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Bail after a short window so a server hiccup on stats doesn't trap the
  // user on the loading screen forever — proceed with whatever we have.
  const [statsTimeout, setStatsTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setStatsTimeout(true), 1500);
    return () => clearTimeout(t);
  }, []);

  // Returning v1 users (memories already exist) skip onboarding — they're
  // not first-run even without the flag. Compute inline so we don't flash
  // the onboarding screen for a frame while a useEffect catches up.
  const hasMemories = (memHook.stats?.total ?? 0) > 0;
  const effectivelyOnboarded = flagged || hasMemories;

  // Backfill the flag for v1 users so future sessions don't depend on the
  // stats round-trip. Side-effect only — doesn't influence routing this render.
  useEffect(() => {
    if (hasMemories && !flagged) {
      try {
        localStorage.setItem(ONBOARDED_KEY, 'true');
      } catch {}
    }
  }, [hasMemories, flagged]);

  // Stats loaded means we know memory state. Otherwise wait briefly for
  // stats — only relevant when flag isn't set; once flagged, route immediately.
  const statsKnown = memHook.stats !== null || statsTimeout;
  if (!flagged && !statsKnown) {
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
        CLUDE · loading memory
      </div>
    );
  }

  if (!effectivelyOnboarded) {
    return (
      <CcOnboarding
        theme={theme}
        onComplete={() => {
          try {
            localStorage.setItem(ONBOARDED_KEY, 'true');
          } catch {}
          setFlagged(true);
        }}
      />
    );
  }

  return <CcChat theme={theme} setTheme={setTheme} />;
}
