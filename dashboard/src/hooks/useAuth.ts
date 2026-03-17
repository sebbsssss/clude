import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { api } from '../lib/api';
import type { AuthState, AuthMode } from './AuthContext';

export function useAuth(): AuthState {
  const { ready, authenticated: privyAuth, login, logout, user, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const [cortexAuth, setCortexAuth] = useState(false);
  const [cortexReady, setCortexReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [tokenReady, setTokenReady] = useState(false);

  // Ref to prevent emitRefresh from firing more than once per auth session
  const hasRefreshed = useRef(false);
  // Ref to hold getAccessToken so the effect doesn't re-fire on every render
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  // Extract wallet address from connected wallets (prefer Solana)
  const walletAddress = useMemo(() => {
    if (!wallets || wallets.length === 0) return null;
    // Debug: log all wallets to understand what Privy returns
    console.log('[useAuth] wallets:', wallets.map(w => ({
      address: w.address?.slice(0, 8) + '...',
      clientType: w.walletClientType,
      chainType: (w as any).chainType,
      connectorType: (w as any).connectorType,
      type: (w as any).type,
    })));
    // Solana addresses are base58 (32-44 chars, no 0x prefix)
    const solanaWallet = wallets.find(w =>
      w.walletClientType === 'solana' ||
      (w as any).chainType === 'solana' ||
      (w.address && !w.address.startsWith('0x') && w.address.length >= 32 && w.address.length <= 44)
    );
    if (solanaWallet) return solanaWallet.address;
    // Fallback: skip EVM addresses (0x...), return null instead
    const nonEvm = wallets.find(w => w.address && !w.address.startsWith('0x'));
    if (nonEvm) return nonEvm.address;
    return null;
  }, [wallets]);

  const email = useMemo(() => {
    return user?.email?.address || null;
  }, [user]);

  // On mount: check localStorage for saved cortex API key
  useEffect(() => {
    const savedKey = localStorage.getItem('cortex_api_key');
    const savedEndpoint = localStorage.getItem('cortex_endpoint');
    if (savedKey) {
      api.setToken(savedKey);
      if (savedEndpoint) api.setAgentEndpoint(savedEndpoint);
      api.setMode('cortex');
      api.validateApiKey().then(valid => {
        if (valid) {
          setCortexAuth(true);
          setAuthMode('cortex');
          setTokenReady(true);
          if (!hasRefreshed.current) {
            hasRefreshed.current = true;
            api.emitRefresh();
          }
        } else {
          localStorage.removeItem('cortex_api_key');
          localStorage.removeItem('cortex_endpoint');
          api.setMode('legacy');
        }
        setCortexReady(true);
      });
    } else {
      setCortexReady(true);
    }
  }, []);

  // Privy auth: set token, but DON'T refresh until wallet is available
  useEffect(() => {
    if (privyAuth && !cortexAuth && !tokenReady) {
      setAuthMode('privy');
      api.setMode('legacy');
      getAccessTokenRef.current().then(token => {
        if (token) {
          api.setToken(token);
          api.setWalletAddress(walletAddress);
          setTokenReady(true);
          // Only refresh if wallet is already available; otherwise wait for wallet effect
          if (walletAddress && !hasRefreshed.current) {
            hasRefreshed.current = true;
            api.emitRefresh();
          }
        }
      });
    }
  }, [privyAuth, cortexAuth, tokenReady, walletAddress]);

  // Update wallet on API when it changes (Privy wallets load async)
  // This is the primary refresh trigger — fires once wallet address is resolved
  useEffect(() => {
    if (authMode === 'privy' && walletAddress) {
      api.setWalletAddress(walletAddress);
      // Always re-fetch when wallet becomes available (even if hasRefreshed was set)
      if (tokenReady) {
        hasRefreshed.current = true;
        api.emitRefresh();
      }
    }
  }, [walletAddress, authMode, tokenReady]);

  const loginWithApiKey = useCallback(async (apiKey: string, endpoint?: string): Promise<boolean> => {
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
      hasRefreshed.current = true;
      api.emitRefresh();
    } else {
      api.setMode('legacy');
    }
    return valid;
  }, []);

  const handleLogin = useCallback(() => {
    login();
  }, [login]);

  const handleLogout = useCallback(() => {
    setTokenReady(false);
    hasRefreshed.current = false;
    api.setWalletAddress(null);
    if (authMode === 'cortex') {
      localStorage.removeItem('cortex_api_key');
      localStorage.removeItem('cortex_endpoint');
      setCortexAuth(false);
      setAuthMode(null);
      api.setToken('');
      api.setMode('legacy');
    } else {
      api.setToken('');
      logout();
    }
    api.emitRefresh();
  }, [authMode, logout]);

  const isAuthenticated = privyAuth || cortexAuth;

  return {
    authenticated: isAuthenticated,
    // Ready when: (1) not authenticated and Privy+cortex init done, or (2) authenticated and token is set
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
