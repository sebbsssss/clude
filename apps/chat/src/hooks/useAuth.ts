import { useState, useEffect, useCallback, useRef } from 'react';
import { useSolanaWallet } from './use-solana-wallet';
import { api } from '../lib/api';
import { SOLANA_NETWORK } from '../lib/solana-config';
import type { AuthState } from './AuthContext';

const STORAGE_KEYS = {
  cortexKey: 'cortex_api_key',
  wallet: 'cortex_wallet',
  network: 'cortex_network',
} as const;

// Legacy keys from before chat/dashboard unification — migrate on first load
const LEGACY_KEYS = {
  cortexKey: 'chat_cortex_key',
  wallet: 'chat_wallet',
} as const;

export function useAuth(): AuthState {
  const { 
    ready: privyReady, 
    authenticated: privyAuth, 
    login: privyLogin, 
    logout: privyLogout, 
    getAccessToken,
    wallets,
    findWallet
  } = useSolanaWallet();

  const [cortexKey, setCortexKey] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'privy' | 'cortex' | null>(null);
  const [network, setNetworkState] = useState<'mainnet-beta' | 'devnet'>(SOLANA_NETWORK);
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
    const savedNetwork = localStorage.getItem(STORAGE_KEYS.network) as 'mainnet-beta' | 'devnet';

    if (savedKey) {
      api.setKey(savedKey);
      setCortexKey(savedKey);
      setWalletAddress(savedWallet);
      setAuthMode(savedWallet ? 'privy' : 'cortex');
    }
    if (savedNetwork) {
      setNetworkState(savedNetwork);
    }
    setReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- only needs to run once on mount

  // ... (auto-register useEffect - line 61-88 - kept as is)

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

  const setNetwork = useCallback((newNetwork: 'mainnet-beta' | 'devnet') => {
    setNetworkState(newNetwork);
    localStorage.setItem(STORAGE_KEYS.network, newNetwork);
  }, []);

  return {
    ready,
    authenticated: !!cortexKey,
    walletAddress,
    authMode,
    cortexKey,
    network,
    login,
    logout,
    loginWithApiKey,
    setNetwork,
  };
}
