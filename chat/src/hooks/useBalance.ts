import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthContext } from './AuthContext';
import { api } from '../lib/api';

export interface Balance {
  balance_usdc: number;
  wallet_address: string;
  promo?: boolean;
  promo_credit_usdc?: number;
}

export function useBalance() {
  const { authenticated } = useAuthContext();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fastPollCountRef = useRef(0);

  const fetchBalance = useCallback(async () => {
    if (!authenticated) return;
    try {
      const data = await api.getBalance();
      setBalance(data);
    } catch {
      // Balance API may not be live yet — silently ignore
    }
  }, [authenticated]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await fetchBalance();
    } finally {
      setLoading(false);
    }
  }, [fetchBalance]);

  // Start fast polling (every 5s, up to 12 times = 60s) after a top-up
  const pollUntilUpdated = useCallback((previousBalance: number) => {
    fastPollCountRef.current = 0;

    const fastPoll = async () => {
      if (fastPollCountRef.current >= 12) return;
      fastPollCountRef.current += 1;

      try {
        const data = await api.getBalance();
        setBalance(data);
        if (data.balance_usdc !== previousBalance) return; // balance changed, stop
      } catch {
        // ignore
      }

      pollTimerRef.current = setTimeout(fastPoll, 5_000);
    };

    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(fastPoll, 5_000);
  }, []);

  // Normal polling every 30s when authenticated
  useEffect(() => {
    if (!authenticated) {
      setBalance(null);
      return;
    }

    fetchBalance();

    const interval = setInterval(fetchBalance, 30_000);
    return () => clearInterval(interval);
  }, [authenticated, fetchBalance]);

  // Cleanup fast poll on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  return { balance, loading, refresh, pollUntilUpdated };
}
