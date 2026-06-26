import { useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { MemoryExportPanel } from '@clude/ui';
import type { PmpArtifact } from '@clude/ui';
import { createPmpExportApi } from '../lib/pmp-export-api';

/**
 * Portable Memory Pack (.pmp) export surface for the user-facing chat app.
 * Mounts the shared @clude/ui MemoryExportPanel, authenticated with the user's
 * Privy access token (the /v1/pmp/* endpoints are Privy-gated). The backend
 * resolves the owner wallet from the verified token.
 */
export function ExportMemories() {
  const { getAccessToken, user } = usePrivy();

  const exportApi = useMemo(() => createPmpExportApi(getAccessToken), [getAccessToken]);
  const walletAddress = user?.wallet?.address ?? null;

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
