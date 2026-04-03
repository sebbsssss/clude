import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { BrowserRouter } from 'react-router-dom'
import { MAINNET_RPC, DEVNET_RPC } from './lib/solana-config'
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
        loginMethods: ['wallet'],
        embeddedWallets: { solana: { createOnLogin: 'off' } },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
        solana: {
          rpcs: {
            'solana:mainnet': { rpc: MAINNET_RPC },
            'solana:devnet': { rpc: DEVNET_RPC },
          } as any
        }
      }}
    >
      <BrowserRouter basename="/chat">
        <App />
      </BrowserRouter>
    </PrivyProvider>
  </StrictMode>,
)
