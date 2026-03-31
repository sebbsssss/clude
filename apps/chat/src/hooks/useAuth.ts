import { useState, useEffect, useCallback, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets } from '@privy-io/react-auth/solana';
import { api } from '../lib/api';
import type { AuthState } from './AuthContext';

const STORAGE_KEYS = {
  cortexKey: 'cortex_api_key',
  wallet: 'cortex_wallet',
} as const;

// Legacy keys from before chat/dashboard unification — migrate on first load
const LEGACY_KEYS = {
  cortexKey: 'chat_cortex_key',
  wallet: 'chat_wallet',
} as const;

export function useAuth(): AuthState {
  const { ready: privyReady, authenticated: privyAuth, login: privyLogin, logout: privyLogout, getAccessToken } = usePrivy();
  const { wallets } = useSolanaWallets();

  const [cortexKey, setCortexKey] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'privy' | 'cortex' | null>(null);
  const [ready, setReady] = useState(false);

  const cortexInitRef = useRef(false);
  const loggingOutRef = useRef(false);

  // Restore saved cortex key on mount (with legacy key migration)
  useEffect(() => {
    // Migrate legacy chat-specific keys to shared keys
    const legacyKey = localStorage.getItem(LEGACY_KEYS.cortexKey);
    const legacyWallet = localStorage.getItem(LEGACY_KEYS.wallet);
    if (legacyKey && !localStorage.getItem(STORAGE_KEYS.cortexKey)) {
      localStorage.setItem(STORAGE_KEYS.cortexKey, legacyKey);
      if (legacyWallet) localStorage.setItem(STORAGE_KEYS.wallet, legacyWallet);
    }
    if (legacyKey) localStorage.removeItem(LEGACY_KEYS.cortexKey);
    if (legacyWallet) localStorage.removeItem(LEGACY_KEYS.wallet);

    const savedKey = localStorage.getItem(STORAGE_KEYS.cortexKey);
    const savedWallet = localStorage.getItem(STORAGE_KEYS.wallet);
    if (savedKey) {
      // Trust the key optimistically — if invalid, the first real API call
      // will 401 and the auth-expired handler will logout.
      api.setKey(savedKey);
      setCortexKey(savedKey);
      setWalletAddress(savedWallet);
      setAuthMode(savedWallet ? 'privy' : 'cortex');
    }
    setReady(true);
  }, [privyReady]);

  // Privy auth → auto-register
  useEffect(() => {
    if (cortexInitRef.current || loggingOutRef.current || !privyReady || !privyAuth || cortexKey) return;

    // Prefer the wallet already selected in dashboard (shared via localStorage)
    const savedWallet = localStorage.getItem(STORAGE_KEYS.wallet);
    const wallet = (savedWallet && wallets?.find(w => w.address === savedWallet)?.address)
      || wallets?.[0]?.address;
    if (!wallet) return;

    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;

        const result = await api.autoRegister(token, wallet);
        api.setKey(result.api_key);
        setCortexKey(result.api_key);
        setWalletAddress(wallet);
        setAuthMode('privy');

        localStorage.setItem(STORAGE_KEYS.cortexKey, result.api_key);
        localStorage.setItem(STORAGE_KEYS.wallet, wallet);
      } catch (err) {
        console.error('Auto-register failed:', err);
      }
    })();
  }, [privyReady, privyAuth, wallets, cortexKey]);

  // (No-op: ready starts true, no need to wait for Privy)

  const login = useCallback(() => {
    privyLogin();
  }, [privyLogin]);

  const logout = useCallback(() => {
    api.onAuthExpired(null);
    loggingOutRef.current = true;
    setCortexKey(null);
    setWalletAddress(null);
    setAuthMode(null);
    api.setKey(null);
    localStorage.removeItem(STORAGE_KEYS.cortexKey);
    localStorage.removeItem(STORAGE_KEYS.wallet);
    localStorage.removeItem('cortex_endpoint');
    localStorage.removeItem('chat_selected_model');
    if (privyAuth) {
      privyLogout().finally(() => {
        loggingOutRef.current = false;
      });
    } else {
      loggingOutRef.current = false;
    }
  }, [privyAuth, privyLogout]);

  // Stable ref for logout — avoids effect re-running on identity changes
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  // On 401 (key revoked): logout gracefully
  useEffect(() => {
    if (!cortexKey) return;

    api.onAuthExpired(() => logoutRef.current());
    return () => api.onAuthExpired(null);
  }, [cortexKey]);

  const loginWithApiKey = useCallback(async (apiKey: string): Promise<boolean> => {
    if (cortexKey) {
      setCortexKey(null);
      setWalletAddress(null);
      setAuthMode(null);
      api.setKey(null);
      localStorage.removeItem(STORAGE_KEYS.cortexKey);
      localStorage.removeItem(STORAGE_KEYS.wallet);
    }

    api.setKey(apiKey);
    const valid = await api.validateKey();
    if (!valid) {
      api.setKey(null);
      return false;
    }

    setCortexKey(apiKey);
    setAuthMode('cortex');
    localStorage.setItem(STORAGE_KEYS.cortexKey, apiKey);
    return true;
  }, [cortexKey]);

  return {
    ready,
    authenticated: !!cortexKey,
    walletAddress,
    authMode,
    cortexKey,
    login,
    logout,
    loginWithApiKey,
  };
}
