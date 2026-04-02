import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import App from "./App";
import { LotrExplore } from "./pages/lotr-explore";
import "./index.css";

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID;

if (!PRIVY_APP_ID) {
  throw new Error("VITE_PRIVY_APP_ID is required. Set it in dashboard/.env");
}

const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: true });

const root = ReactDOM.createRoot(document.getElementById("root")!);

// Guest route — no Privy, no BrowserRouter (campaign, temporary)
if (
  window.location.pathname === "/lotr" ||
  window.location.pathname === "/dashboard/lotr"
) {
  root.render(
    <React.StrictMode>
      <LotrExplore />
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <PrivyProvider
        appId={PRIVY_APP_ID}
        config={{
          appearance: {
            theme: "light",
            accentColor: "#2244ff",
            walletList: ["phantom", "solflare", "backpack"],
          },
          loginMethods: ["wallet"],
          solana: {
            rpcs: {
              'solana:mainnet': { rpc: "https://api.mainnet-beta.solana.com" },
            } as any,
          },
          embeddedWallets: {
            ethereum: { createOnLogin: "off" },
            solana: { createOnLogin: "off" },
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
    </React.StrictMode>,
  );
}
