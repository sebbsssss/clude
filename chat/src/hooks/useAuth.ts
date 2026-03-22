import { useState, useEffect, useCallback, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import { api } from '../lib/api';
import type { AuthState } from './AuthContext';

const STORAGE_KEYS = {
  cortexKey: 'chat_cortex_key',
  wallet: 'chat_wallet',
} as const;

export function useAuth(): AuthState {
  const { ready: privyReady, authenticated: privyAuth, login: privyLogin, logout: privyLogout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();

  const [cortexKey, setCortexKey] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'privy' | 'cortex' | null>(null);
  const [ready, setReady] = useState(false);

  const cortexInitRef = useRef(false);

  // Restore saved cortex key on mount
  useEffect(() => {
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
    if (cortexInitRef.current || !privyReady || !privyAuth || cortexKey) return;

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

  // Mark ready when Privy loads (if no saved key)
  useEffect(() => {
    if (privyReady && !cortexInitRef.current && !ready) {
      setReady(true);
    }
  }, [privyReady, ready]);

  const login = useCallback(() => {
    privyLogin();
  }, [privyLogin]);

  const logout = useCallback(() => {
    setCortexKey(null);
    setWalletAddress(null);
    setAuthMode(null);
    api.setKey(null);
    localStorage.removeItem(STORAGE_KEYS.cortexKey);
    localStorage.removeItem(STORAGE_KEYS.wallet);
    localStorage.removeItem('chat_selected_model');
    if (privyAuth) {
      privyLogout();
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
