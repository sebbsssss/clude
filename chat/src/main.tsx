import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { BrowserRouter } from 'react-router-dom'
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
          walletList: ['phantom', 'solflare', 'backpack', 'detected_wallets'],
        },
        loginMethods: ['wallet'],
        walletChainType: 'solana-only',
        embeddedWallets: { createOnLogin: 'off' },
        solanaClusters: [{ name: 'mainnet-beta', rpcUrl: 'https://api.mainnet-beta.solana.com' }],
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
      }}
    >
      <BrowserRouter basename="/chat">
        <App />
      </BrowserRouter>
    </PrivyProvider>
  </StrictMode>,
)
