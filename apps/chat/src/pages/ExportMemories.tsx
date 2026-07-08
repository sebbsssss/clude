import { useMemo } from 'react';
import { MemoryExportPanel } from '@clude/ui';
import type { PmpArtifact } from '@clude/ui';
import { useSolanaWallet } from '../hooks/use-solana-wallet';
import { createPmpExportApi } from '../lib/pmp-export-api';

/**
 * Portable Memory Pack (.pmp) export surface for the user-facing chat app.
 * Mounts the shared @clude/ui MemoryExportPanel, authenticated with the user's
 * Privy access token (the /v1/pmp/* endpoints are Privy-gated). The backend
 * resolves the owner wallet from the verified token.
 *
 * Encryption-by-default fails closed for users without a registered owner key, so
 * the adapter is given the wallet's `signMessage` + address: the panel registers
 * the key on-demand (sign OWNER_SIGN_MESSAGE → POST) and retries the export.
 */
export function ExportMemories() {
  const { getAccessToken, signMessage, wallets } = useSolanaWallet();
  const walletAddress = wallets[0]?.address ?? null;

  const exportApi = useMemo(
    () => createPmpExportApi(getAccessToken, signMessage, walletAddress),
    [getAccessToken, signMessage, walletAddress],
  );

  function handleDownload(_artifact: PmpArtifact, downloadUrl: string) {
    window.open(downloadUrl, '_blank', 'noopener');
  }

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: '0 20px' }}>
      <MemoryExportPanel
        api={exportApi}
        walletAddress={walletAddress}
        theme="auto"
        onDownload={handleDownload}
      />
    </div>
  );
}
