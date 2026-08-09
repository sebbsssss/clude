import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { BrowserRouter } from 'react-router-dom'
import type { Rpc, SolanaRpcApi } from '@solana/kit'
import {
  MAINNET_RPC,
  DEVNET_RPC,
  MAINNET_RPC_SUBSCRIPTIONS,
  DEVNET_RPC_SUBSCRIPTIONS,
  SOLANA_CHAIN_IDS,
} from './lib/solana-config'
import { App } from './App'
import './index.css'

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: true,
});

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID;
if (!privyAppId) throw new Error('VITE_PRIVY_APP_ID is required');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider
      appId={privyAppId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#2244ff',
          showWalletLoginFirst: true,
          walletList: ['phantom', 'solflare', 'backpack'],
        },
        loginMethods: ['wallet', 'email'],
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' } },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        solana: {
          // `createSolanaRpc(url: string)` widens to a union that includes
          // `Rpc<SolanaRpcApiForAllClusters>` (no `requestAirdrop`), but Privy's
          // config types `rpc` as the full `Rpc<SolanaRpcApi>`. The runtime
          // object does expose every method; assert the precise type Privy
          // expects (same shared @solana/kit version) to reconcile the union.
          rpcs: {
            [SOLANA_CHAIN_IDS.mainnet]: {
              rpc: MAINNET_RPC as Rpc<SolanaRpcApi>,
              rpcSubscriptions: MAINNET_RPC_SUBSCRIPTIONS,
              blockExplorerUrl: 'https://explorer.solana.com',
            },
            [SOLANA_CHAIN_IDS.devnet]: {
              rpc: DEVNET_RPC as Rpc<SolanaRpcApi>,
              rpcSubscriptions: DEVNET_RPC_SUBSCRIPTIONS,
              blockExplorerUrl: 'https://explorer.solana.com?cluster=devnet',
            },
          }
        }
      }}
    >
      <BrowserRouter basename="/chat">
        <App />
      </BrowserRouter>
    </PrivyProvider>
  </StrictMode>,
)
