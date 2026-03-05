// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createHelius } = require('helius-sdk') as { createHelius: (apiKey: string) => any };
import { Connection, PublicKey } from '@solana/web3.js';
import { config } from '../config';
import { createChildLogger } from './logger';
import { HELIUS_BALANCES_BASE_URL } from '../utils/constants';
import type { HeliusBalancesResponse, HeliusTokenBalance } from '../types/api';

const log = createChildLogger('helius-client');

const helius = createHelius(config.helius.apiKey);
const heliusRpcUrl = `https://mainnet.helius-rpc.com/?api-key=${config.helius.apiKey}`;
const connection = new Connection(heliusRpcUrl);

export interface WalletTransaction {
  signature: string;
  timestamp: number;
  type: string;
  description: string;
  fee: number;
  nativeTransfers: Array<{
    fromUserAccount: string | null;
    toUserAccount: string | null;
    amount: number;
  }>;
  tokenTransfers: Array<{
    mint: string;
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
  }>;
}

export interface TokenBalance {
  mint: string;
  amount: number;
  decimals: number;
}

export async function getWalletHistory(address: string, limit = 50): Promise<WalletTransaction[]> {
  log.debug({ address, limit }, 'Fetching wallet history');
  try {
    // Step 1: Get transaction signatures for the wallet
    const pubkey = new PublicKey(address);
    const signatures = await connection.getSignaturesForAddress(pubkey, { limit });
    const sigStrings = signatures.map(s => s.signature);

    if (sigStrings.length === 0) return [];

    // Step 2: Parse transactions via Helius (max 100 per call)
    const batches: string[][] = [];
    for (let i = 0; i < sigStrings.length; i += 100) {
      batches.push(sigStrings.slice(i, i + 100));
    }

    const allTxs: WalletTransaction[] = [];
    for (const batch of batches) {
      const txs = await helius.parseTransactions({ transactions: batch });
      for (const tx of txs) {
        allTxs.push({
          signature: tx.signature,
          timestamp: tx.timestamp,
          type: tx.type,
          description: tx.description,
          fee: tx.fee,
          nativeTransfers: (tx.nativeTransfers || []).map((nt: any) => ({
            fromUserAccount: nt.fromUserAccount,
            toUserAccount: nt.toUserAccount,
            amount: nt.amount,
          })),
          tokenTransfers: (tx.tokenTransfers || []).map((tt: any) => ({
            mint: tt.mint,
            fromUserAccount: tt.fromUserAccount || '',
            toUserAccount: tt.toUserAccount || '',
            tokenAmount: tt.tokenAmount,
          })),
        });
      }
    }

    return allTxs;
  } catch (err) {
    // Helius SDK errors can contain circular refs that crash pino's serializer.
    // Extract a plain message to avoid "Cannot add property Symbol(circular-ref-tag)".
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error({ address, error: errMsg }, 'Failed to fetch wallet history');
    return [];
  }
}

export async function getTokenBalances(address: string): Promise<TokenBalance[]> {
  log.debug({ address }, 'Fetching token balances');
  try {
    const url = `${HELIUS_BALANCES_BASE_URL}/${address}/balances?api-key=${config.helius.apiKey}`;
    const res = await fetch(url);
    const data = await res.json() as HeliusBalancesResponse;
    const tokens: HeliusTokenBalance[] = data.tokens || [];
    return tokens.map((t: HeliusTokenBalance) => ({
      mint: t.mint,
      amount: t.amount / Math.pow(10, t.decimals || 0),
      decimals: t.decimals || 0,
    }));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error({ address, error: errMsg }, 'Failed to fetch token balances');
    return [];
  }
}

export async function getCludeBalance(address: string): Promise<number> {
  if (!config.solana.cludeTokenMint) return 0;
  const balances = await getTokenBalances(address);
  const clude = balances.find(b => b.mint === config.solana.cludeTokenMint);
  return clude?.amount || 0;
}

export function getHeliusInstance(): any {
  return helius;
}
