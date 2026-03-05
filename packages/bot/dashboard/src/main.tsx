import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PrivyProvider } from '@privy-io/react-auth';
import App from './App';
import './index.css';

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID;

if (!PRIVY_APP_ID) {
  throw new Error('VITE_PRIVY_APP_ID is required. Set it in dashboard/.env');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'light',
          accentColor: '#2244ff',
          walletList: ['phantom', 'solflare', 'backpack', 'detected_wallets'],
        },
        loginMethods: ['wallet', 'email'],
        defaultChain: { id: 101, name: 'Solana', network: 'mainnet-beta' } as any,
        supportedChains: [{ id: 101, name: 'Solana', network: 'mainnet-beta' } as any],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        externalWallets: {
          solana: { connectors: (connectors) => connectors },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PrivyProvider>
  </React.StrictMode>
);
