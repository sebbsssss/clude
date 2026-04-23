import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import { api } from '../lib/api';
import type { AuthState, AuthMode } from './AuthContext';

export function useAuth(): AuthState {
  const { ready, authenticated: privyAuth, login, logout, user, getAccessToken } = usePrivy();
  const { wallets: solanaWallets } = useWallets();
  const [cortexAuth, setCortexAuth] = useState(false);
  const [cortexReady, setCortexReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [tokenReady, setTokenReady] = useState(false);

  const hasRefreshed = useRef(false);
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;
  const refreshingRef = useRef<Promise<string | null> | null>(null);

  // Track whether cortex init is in progress — blocks Privy from overriding
  const cortexInitRef = useRef(false);

  // Extract Solana wallet address — prefer the one already selected in chat/dashboard
  const walletAddress = useMemo(() => {
    if (!solanaWallets || solanaWallets.length === 0) return null;
    const saved = localStorage.getItem('cortex_wallet');
    if (saved && solanaWallets.find(w => w.address === saved)) return saved;
    return solanaWallets[0]?.address || null;
  }, [solanaWallets]);

  const email = useMemo(() => {
    return user?.email?.address || null;
  }, [user]);

  // On mount: check localStorage for saved cortex API key
  // Trust the key optimistically — if it's invalid, the first real API call
  // will 401 and the existing auth-expired handler will log the user out.
  useEffect(() => {
    const savedKey = localStorage.getItem('cortex_api_key');
    const savedEndpoint = localStorage.getItem('cortex_endpoint');
    if (savedKey) {
      cortexInitRef.current = true;
      api.setToken(savedKey);
      if (savedEndpoint) api.setAgentEndpoint(savedEndpoint);
      api.setMode('cortex');
      api.setWalletAddress(null);
      setCortexAuth(true);
      setAuthMode('cortex');
      setTokenReady(true);
      hasRefreshed.current = true;
      api.emitRefresh();
    }
    setCortexReady(true);
  }, []);

  // Privy auth: auto-register to get a clk_* key (works for both wallet and email login)
  useEffect(() => {
    if (cortexInitRef.current || cortexAuth) return;
    if (!ready || !privyAuth || tokenReady) return;

    getAccessTokenRef.current().then(async (token) => {
      if (!token) return;
      try {
        const wallet = walletAddress || undefined;
        const res = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/chat/auto-register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(wallet ? { wallet } : {}),
        });
        if (!res.ok) throw new Error('Auto-register failed');
        const data = await res.json();

        cortexInitRef.current = true;
        api.setToken(data.api_key);
        api.setMode('cortex');
        api.setWalletAddress(null);
        localStorage.setItem('cortex_api_key', data.api_key);
        setCortexAuth(true);
        setAuthMode('cortex');
        setTokenReady(true);
        hasRefreshed.current = true;
        api.emitRefresh();
      } catch (err) {
        console.error('Auto-register failed:', err);
      }
    });
  }, [ready, privyAuth, cortexAuth, tokenReady, walletAddress]);

  // Update wallet when it loads (Privy wallets are async)
  useEffect(() => {
    if (authMode === 'privy' && walletAddress) {
      api.setWalletAddress(walletAddress);
      if (tokenReady) {
        hasRefreshed.current = true;
        api.emitRefresh();
      }
    }
  }, [walletAddress, authMode, tokenReady]);

  const loginWithApiKey = useCallback(async (apiKey: string, endpoint?: string): Promise<boolean> => {
    // Fully switch to cortex — clear all privy state
    cortexInitRef.current = true;
    api.setWalletAddress(null);
    api.setToken(apiKey);
    if (endpoint) api.setAgentEndpoint(endpoint);
    api.setMode('cortex');
    const valid = await api.validateApiKey();
    if (valid) {
      localStorage.setItem('cortex_api_key', apiKey);
      if (endpoint) localStorage.setItem('cortex_endpoint', endpoint);
      setCortexAuth(true);
      setAuthMode('cortex');
      setTokenReady(true);
      if (privyAuth) {
        try { logout(); } catch {}
      }
      hasRefreshed.current = true;
      api.emitRefresh();
    } else {
      cortexInitRef.current = false;
      api.setMode('legacy');
    }
    return valid;
  }, [privyAuth, logout]);

  const handleLogin = useCallback(async () => {
    // If Privy already has an active session but the app considers the user
    // unauthenticated (e.g. cortex key cleared), logout first to avoid the
    // "already logged in" error, then re-open the login modal cleanly.
    if (privyAuth) {
      await logout();
    }
    login();
  }, [privyAuth, login, logout]);

  const handleLogout = useCallback(() => {
    // Clear everything
    api.onAuthExpired(null);
    cortexInitRef.current = false;
    setTokenReady(false);
    hasRefreshed.current = false;
    setCortexAuth(false);
    setAuthMode(null);
    api.setWalletAddress(null);
    api.setToken('');
    api.setMode('legacy');
    api.setAgentEndpoint(import.meta.env.VITE_API_BASE || '');
    localStorage.removeItem('cortex_api_key');
    localStorage.removeItem('cortex_endpoint');
    localStorage.removeItem('cortex_wallet');
    if (privyAuth) {
      logout();
    }
    // Don't emitRefresh() here: listeners would re-fetch in legacy mode
    // against requirePrivyAuth endpoints and cascade into 401s before the
    // app re-renders to Landing. The unmount on re-render is enough.
  }, [privyAuth, logout]);

  // Stable ref for handleLogout — avoids effect re-running on identity changes
  const handleLogoutRef = useRef(handleLogout);
  handleLogoutRef.current = handleLogout;

  // On 401: logout. Only active after auth is fully ready (tokenReady)
  // to avoid race conditions during auto-register.
  useEffect(() => {
    if (!tokenReady) return;
    if (!privyAuth && !cortexAuth) return;

    api.onAuthExpired(() => {
      handleLogoutRef.current();
    });

    return () => api.onAuthExpired(null);
  }, [privyAuth, cortexAuth, tokenReady]);

  const isAuthenticated = (privyAuth || cortexAuth) && tokenReady;

  return {
    authenticated: isAuthenticated,
    ready: isAuthenticated ? (tokenReady && cortexReady) : (ready && cortexReady),
    walletAddress,
    userId: user?.id || null,
    email,
    authMode,
    login: handleLogin,
    logout: handleLogout,
    loginWithApiKey,
  };
}
