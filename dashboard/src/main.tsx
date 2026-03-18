import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import App from './App';
import './index.css';

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID;

if (!PRIVY_APP_ID) {
  throw new Error('VITE_PRIVY_APP_ID is required. Set it in dashboard/.env');
}

const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'light',
          accentColor: '#2244ff',
          walletList: ['phantom', 'solflare', 'backpack', 'detected_wallets'],
          walletChainType: 'solana-only',
        },
        loginMethods: ['wallet'],
        solanaClusters: [
          { name: 'mainnet-beta', rpcUrl: 'https://api.mainnet-beta.solana.com' },
        ],
        embeddedWallets: {
          createOnLogin: 'off',
        },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
      }}
    >
      <BrowserRouter basename="/dashboard">
        <App />
      </BrowserRouter>
    </PrivyProvider>
  </React.StrictMode>
);
