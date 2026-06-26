import { useMemo } from 'react';
import { MemoryExportPanel } from '@clude/ui';
import type { ExportResult, PmpArtifact } from '@clude/ui';
import { useAuthContext } from '../hooks/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { createPmpExportApi } from '../lib/pmp-export-api';

/**
 * Portable Memory Pack (.pmp) export surface. Mounts the shared
 * @clude/ui MemoryExportPanel, wired to the dashboard's owner-scoped
 * /v1/pmp/* endpoints via the API client. Sits alongside the legacy
 * .clude-pack export on /packs.
 */
export function ExportMemories() {
  const { walletAddress } = useAuthContext();
  const { isDark } = useTheme();

  // Stable adapter — the auth token/base URL live on the api singleton, so the
  // object itself never needs to change between renders.
  const exportApi = useMemo(() => createPmpExportApi(), []);

  function handleDownload(_artifact: PmpArtifact, downloadUrl: string) {
    window.open(downloadUrl, '_blank', 'noopener');
  }

  function handleExported(_result: ExportResult) {
    // Hook for future toasts/analytics. The panel renders its own result card.
  }

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>
          Memory Packs
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>
          Export to .pmp
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7, maxWidth: 640 }}>
          Package a selection of your memories into a portable, verifiable
          {' '}<code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>.pmp</code> pack.
          Choose what to include, preview the count, then export a signed artifact.
        </p>
      </div>

      <div style={{ maxWidth: 560 }}>
        <MemoryExportPanel
          api={exportApi}
          walletAddress={walletAddress}
          theme={isDark ? 'dark' : 'light'}
          onDownload={handleDownload}
          onExported={handleExported}
        />
      </div>
    </div>
  );
}
