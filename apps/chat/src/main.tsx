import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { BrowserRouter } from 'react-router-dom'
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
          rpcs: {
            [SOLANA_CHAIN_IDS.mainnet]: {
              rpc: MAINNET_RPC,
              rpcSubscriptions: MAINNET_RPC_SUBSCRIPTIONS,
              blockExplorerUrl: 'https://explorer.solana.com',
            },
            [SOLANA_CHAIN_IDS.devnet]: {
              rpc: DEVNET_RPC,
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
