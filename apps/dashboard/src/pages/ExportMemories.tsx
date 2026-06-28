import { useCallback, useMemo } from 'react';
import { useWallets, useSignMessage } from '@privy-io/react-auth/solana';
import { MemoryExportPanel } from '@clude/ui';
import { OWNER_SIGN_MESSAGE } from '@clude/shared/core/owner-key-constants';
import type { ExportResult, PmpArtifact } from '@clude/ui';
import { useAuthContext } from '../hooks/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { createPmpExportApi } from '../lib/pmp-export-api';

/**
 * Portable Memory Pack (.pmp) export surface. Mounts the shared
 * @clude/ui MemoryExportPanel, wired to the dashboard's owner-scoped
 * /v1/pmp/* endpoints via the API client. Sits alongside the legacy
 * .clude-pack export on /packs.
 *
 * Encryption-by-default fails closed for users without a registered owner key, so
 * the adapter is given a wallet-signature callback: the panel registers the key
 * on-demand (sign OWNER_SIGN_MESSAGE → POST) and retries the export.
 */
export function ExportMemories() {
  const { walletAddress } = useAuthContext();
  const { isDark } = useTheme();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();

  // Sign the fixed OWNER_SIGN_MESSAGE with the connected Solana wallet → the 64-byte signature the
  // registration payload derives from. Throws a friendly error when no wallet is connected.
  const signOwnerMessage = useCallback(async (): Promise<Uint8Array> => {
    const wallet = wallets[0];
    if (!wallet) {
      throw new Error('Connect a Solana wallet to register your encryption key (email-only sessions can’t derive a key).');
    }
    const { signature } = await signMessage({
      message: new TextEncoder().encode(OWNER_SIGN_MESSAGE),
      wallet,
    });
    return signature;
  }, [wallets, signMessage]);

  // Adapter depends on the sign callback so register-on-demand uses the live wallet.
  const exportApi = useMemo(() => createPmpExportApi(signOwnerMessage), [signOwnerMessage]);

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
