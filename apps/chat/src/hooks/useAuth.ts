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

  // Privy auth → auto-register: convert Privy session into a Cortex API key
  useEffect(() => {
    if (cortexInitRef.current || loggingOutRef.current || !privyReady || !privyAuth || cortexKey) return;

    const savedWallet = localStorage.getItem(STORAGE_KEYS.wallet);
    const wallet = (savedWallet && wallets?.find((w: { address: string }) => w.address === savedWallet)?.address)
      || wallets?.[0]?.address;

    // For wallet login: wait until wallet is available
    // For email login: wallets will be empty, proceed without wallet
    const hasWallets = wallets && wallets.length > 0;
    if (hasWallets && !wallet) return; // Wallets loading, wait

    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;

        const result = await api.autoRegister(token, wallet || undefined);
        api.setKey(result.api_key);
        setCortexKey(result.api_key);
        setWalletAddress(result.wallet || wallet || null);
        setAuthMode('privy');

        localStorage.setItem(STORAGE_KEYS.cortexKey, result.api_key);
        if (result.wallet || wallet) {
          localStorage.setItem(STORAGE_KEYS.wallet, result.wallet || wallet);
        }
      } catch (err) {
        console.error('Auto-register failed:', err);
      }
    })();
  }, [privyReady, privyAuth, wallets, cortexKey, getAccessToken]);

  // Email-signup wallet race: Privy provisions the embedded Solana wallet
  // asynchronously, sometimes after our first auto-register call. When the
  // wallet finally lands, re-fire auto-register with the real address — the
  // server's findOrCreateAgentForDid → migrateOwnerWallet flow swaps the
  // synthetic hex owner_wallet for the real one and carries the chat_balances
  // row across. Idempotent: returns the same agent if owner_wallet already
  // matches, so it's safe to fire on every wallet update.
  const lastSyncedWalletRef = useRef<string | null>(null);
  useEffect(() => {
    if (!privyReady || !privyAuth || !cortexKey) return;
    const realWallet = wallets?.[0]?.address;
    if (!realWallet) return;
    if (realWallet === lastSyncedWalletRef.current) return;
    if (realWallet === walletAddress) {
      lastSyncedWalletRef.current = realWallet;
      return;
    }
    lastSyncedWalletRef.current = realWallet;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const result = await api.autoRegister(token, realWallet);
        // If the server returned a different key (key was rotated as part
        // of agent adoption — rare), update local state.
        if (result.api_key && result.api_key !== cortexKey) {
          api.setKey(result.api_key);
          setCortexKey(result.api_key);
          localStorage.setItem(STORAGE_KEYS.cortexKey, result.api_key);
        }
        const finalWallet = result.wallet || realWallet;
        setWalletAddress(finalWallet);
        localStorage.setItem(STORAGE_KEYS.wallet, finalWallet);
      } catch (err) {
        // Migration failure is non-fatal — user can still chat on free tier.
        console.warn('Wallet migration after auto-register failed:', err);
      }
    })();
  }, [privyReady, privyAuth, cortexKey, wallets, walletAddress, getAccessToken]);

  const login = useCallback(async () => {
    // If Privy already has an active session but we have no cortex key
    // (e.g. auto-register failed or key expired), logout first to clear
    // the stale Privy session, then re-login cleanly.
    if (privyAuth) {
      await privyLogout();
    }
    privyLogin();
  }, [privyAuth, privyLogin, privyLogout]);

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
