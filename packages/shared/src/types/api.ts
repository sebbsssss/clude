/**
 * Typed interfaces for external API responses — replaces `as any` casts throughout the codebase.
 */

// Jupiter Price API (Solana)
export interface JupiterPriceResponse {
  data: Record<string, { id: string; type: string; price: string } | undefined>;
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


