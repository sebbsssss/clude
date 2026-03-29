/**
 * Typed interfaces for external API responses — replaces `as any` casts throughout the codebase.
 */

// Jupiter Price API (Solana)
export interface JupiterPriceResponse {
  data: Record<string, { id: string; type: string; price: string } | undefined>;
}

// Allium SOL stats (Solana)
export interface AlliumSolStats {
  items?: Array<{
    latest_price?: number;
    percent_change_1h?: number;
    percent_change_24h?: number;
  }>;
}

// DexScreener Price API (dormant — kept for Base chain switch-back)
export interface DexScreenerResponse {
  pairs: Array<{
    chainId: string;
    dexId: string;
    pairAddress: string;
    baseToken: { address: string; name: string; symbol: string };
    quoteToken: { address: string; name: string; symbol: string };
    priceUsd: string;
    volume: { h24: number; h1?: number };
    priceChange: { h1: number; h24: number };
    liquidity: { usd: number };
  }> | null;
}

// Basescan API — transaction list (dormant — kept for Base chain switch-back)
export interface BasescanTxResponse {
  status: string;
  message: string;
  result: Array<{
    blockNumber: string;
    timeStamp: string;
    hash: string;
    from: string;
    to: string;
    value: string;
    gas: string;
    gasUsed: string;
    gasPrice: string;
    isError: string;
    methodId: string;
    functionName: string;
    input: string;
  }>;
}

// Basescan API — ERC-20 token transfer events (dormant — kept for Base chain switch-back)
export interface BasescanTokenTxResponse {
  status: string;
  message: string;
  result: Array<{
    blockNumber: string;
    timeStamp: string;
    hash: string;
    from: string;
    to: string;
    value: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimal: string;
    contractAddress: string;
    gas: string;
    gasUsed: string;
    gasPrice: string;
  }>;
}

// Allium API responses
export interface AlliumTokenData {
  info?: { symbol?: string; name?: string };
  price?: number;
  attributes?: {
    price_diff_pct_1h?: number;
    price_diff_pct_1d?: number;
    volume_usd_1h?: number;
    volume_usd_1d?: number;
    trade_count_1h?: number;
    trade_count_1d?: number;
    all_time_high?: number;
    holders_count?: number;
  };
}

export interface AlliumNativeStats {
  items?: Array<{
    latest_price?: number;
    percent_change_1h?: number;
    percent_change_24h?: number;
  }>;
}

