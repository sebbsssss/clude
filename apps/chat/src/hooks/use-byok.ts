import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from './AuthContext';
import { useSolanaWallet } from './use-solana-wallet';
import { encryptBYOK, decryptBYOK, BYOK_SIGN_MESSAGE } from '../lib/crypto';
import { api } from '../lib/api';
import type { BYOKProvider } from '../lib/types';

const STORAGE_KEY = 'byok_keys';

/** Per-wallet, per-provider encrypted key storage shape in localStorage. */
type StoredKeys = Record<string, Record<string, string>>; // wallet → provider → encrypted

export interface BYOKState {
  /** Map of provider → decrypted key for the current wallet. */
  keys: Partial<Record<BYOKProvider, string>>;
  /** Set of providers that have keys stored (even if not yet decrypted). */
  storedProviders: BYOKProvider[];
  /** True while we're signing / decrypting on mount. */
  loading: boolean;
  /** Save a BYOK key for a provider (encrypts + stores in localStorage). */
  saveKey: (provider: BYOKProvider, key: string) => Promise<void>;
  /** Remove a stored BYOK key for a provider. */
  removeKey: (provider: BYOKProvider) => void;
  /** Remove all BYOK keys. */
  clearAll: () => void;
  /** Check if a provider has a decrypted key ready. */
  hasKey: (provider: BYOKProvider) => boolean;
}

// ---- localStorage helpers ---- //

function readAllStored(wallet: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as StoredKeys;
    return all[wallet] ?? {};
  } catch {
    return {};
  }
}

function writeProviderKey(wallet: string, provider: string, encrypted: string) {
  let all: StoredKeys = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) all = JSON.parse(raw);
  } catch { /* start fresh */ }
  if (!all[wallet]) all[wallet] = {};
  all[wallet][provider] = encrypted;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function removeProviderKey(wallet: string, provider: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const all = JSON.parse(raw) as StoredKeys;
    if (all[wallet]) {
      delete all[wallet][provider];
      if (Object.keys(all[wallet]).length === 0) delete all[wallet];
    }
    if (Object.keys(all).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function removeAllForWallet(wallet: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const all = JSON.parse(raw) as StoredKeys;
    delete all[wallet];
    if (Object.keys(all).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// ---- Hook ---- //

export function useBYOK(): BYOKState {
  const { authenticated, walletAddress } = useAuthContext();
  const { signMessage, wallets } = useSolanaWallet();

  const [keys, setKeys] = useState<Partial<Record<BYOKProvider, string>>>({});
  const [storedProviders, setStoredProviders] = useState<BYOKProvider[]>([]);
  const [loading, setLoading] = useState(false);

  const SIG_SESSION_KEY = 'byok_sig';

  const getSignatureBytes = useCallback(async (): Promise<Uint8Array | null> => {
    if (!walletAddress) return null;

    // Check sessionStorage first
    try {
      const cached = sessionStorage.getItem(SIG_SESSION_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as { wallet: string; sig: string };
        if (parsed.wallet === walletAddress) {
          return Uint8Array.from(atob(parsed.sig), c => c.charCodeAt(0));
        }
      }
    } catch { /* ignore corrupt cache */ }

    try {
      const message = new TextEncoder().encode(BYOK_SIGN_MESSAGE);
      const bytes = await signMessage(message, walletAddress);
      try {
        sessionStorage.setItem(SIG_SESSION_KEY, JSON.stringify({
          wallet: walletAddress,
          sig: btoa(String.fromCharCode(...bytes)),
        }));
      } catch { /* storage full */ }
      return bytes;
    } catch {
      return null;
    }
  }, [walletAddress, signMessage]);

  // On mount / wallet change: read stored keys and try to decrypt
  useEffect(() => {
    if (!authenticated || !walletAddress) {
      setKeys({});
      setStoredProviders([]);
      api.clearBYOKKeys();
      return;
    }

    const stored = readAllStored(walletAddress);
    const providers = Object.keys(stored) as BYOKProvider[];
    setStoredProviders(providers);

    if (providers.length === 0) {
      setKeys({});
      api.clearBYOKKeys();
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const sigBytes = await getSignatureBytes();
      if (cancelled || !sigBytes) {
        setLoading(false);
        return;
      }

      const decrypted: Partial<Record<BYOKProvider, string>> = {};
      for (const provider of providers) {
        const plain = await decryptBYOK(stored[provider], sigBytes);
        if (cancelled) return;
        if (plain) {
          decrypted[provider] = plain;
          api.setBYOKKey(provider, plain);
        }
      }

      if (!cancelled) {
        setKeys(decrypted);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  // `wallets` is included so the effect re-runs once Privy reconnects
  // wallets on reload — without it, getSignatureBytes fails on the first
  // (wallets-empty) attempt and never retries.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, walletAddress, getSignatureBytes, wallets]);

  const saveKey = useCallback(async (provider: BYOKProvider, key: string) => {
    if (!walletAddress) throw new Error('Wallet not connected');
    const sigBytes = await getSignatureBytes();
    if (!sigBytes) throw new Error('Signature required to encrypt your key');

    const encrypted = await encryptBYOK(key, sigBytes);
    writeProviderKey(walletAddress, provider, encrypted);
    setKeys(prev => ({ ...prev, [provider]: key }));
    setStoredProviders(prev => prev.includes(provider) ? prev : [...prev, provider]);
    api.setBYOKKey(provider, key);
  }, [walletAddress, getSignatureBytes]);

  const removeKey = useCallback((provider: BYOKProvider) => {
    if (walletAddress) removeProviderKey(walletAddress, provider);
    setKeys(prev => {
      const next = { ...prev };
      delete next[provider];
      return next;
    });
    setStoredProviders(prev => prev.filter(p => p !== provider));
    api.setBYOKKey(provider, null);
  }, [walletAddress]);

  const clearAll = useCallback(() => {
    if (walletAddress) removeAllForWallet(walletAddress);
    setKeys({});
    setStoredProviders([]);
    api.clearBYOKKeys();
  }, [walletAddress]);

  const hasKey = useCallback((provider: BYOKProvider) => !!keys[provider], [keys]);

  return { keys, storedProviders, loading, saveKey, removeKey, clearAll, hasKey };
}
