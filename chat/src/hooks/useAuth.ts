import { useState, useEffect, useCallback, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
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
  const { wallets } = useWallets();

  const [cortexKey, setCortexKey] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'privy' | 'cortex' | null>(null);
  // Start ready immediately — guest mode renders instantly while Privy loads in background.
  // Auth upgrades in place when Privy resolves or saved key validates.
  const [ready, setReady] = useState(true);

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
      cortexInitRef.current = true;
      api.setKey(savedKey);
      api.validateKey().then((valid) => {
        if (valid) {
          setCortexKey(savedKey);
          setWalletAddress(savedWallet);
          setAuthMode(savedWallet ? 'privy' : 'cortex');
        } else {
          localStorage.removeItem(STORAGE_KEYS.cortexKey);
          localStorage.removeItem(STORAGE_KEYS.wallet);
          api.setKey(null);
        }
        setReady(true);
        cortexInitRef.current = false;
      });
    } else if (privyReady) {
      setReady(true);
    }
  }, [privyReady]);

  // Privy auth → auto-register
  useEffect(() => {
    if (cortexInitRef.current || loggingOutRef.current || !privyReady || !privyAuth || cortexKey) return;

    const wallet = wallets?.[0]?.address;
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
