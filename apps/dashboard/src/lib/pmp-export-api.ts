// Adapter binding the @clude/ui MemoryExportPanel to the dashboard API client.
//
// The panel is backend-agnostic: it only knows the MemoryExportApi contract
// (preview / export / listArtifacts / registerOwnerKey). This maps that contract
// onto the live, owner-scoped /v1/pmp/* endpoints via the shared `api` singleton,
// so the panel inherits the exact same Bearer-token auth and 401 auth-expiry
// handling as every other authenticated dashboard call.
//
// ENCRYPT-BY-DEFAULT: /v1/pmp/export fails CLOSED (422 `holder_key_unregistered`)
// until the owner registers their key. `api.pmpExport` already surfaces that as the
// singleton's HolderKeyUnregisteredError; `export()` re-throws it as @clude/ui's
// recognizable error so the shared panel can register-on-demand + retry. When the
// page supplies `signOwnerMessage`, `registerOwnerKey` runs the full
// sign → build payload → POST flow (mirroring ExportScreen's register-on-demand).

import {
  buildOwnerKeyRegistration,
  HolderKeyUnregisteredError as UiHolderKeyUnregisteredError,
} from '@clude/ui';
import type {
  ExportRequest,
  ExportResult,
  ExportSelection,
  MemoryExportApi,
  PmpArtifact,
  SelectionPreview,
} from '@clude/ui';
import { api, HolderKeyUnregisteredError } from './api';

/** Sign the fixed OWNER_SIGN_MESSAGE with the connected wallet → 64-byte signature. */
type SignOwnerMessage = () => Promise<Uint8Array>;

/**
 * Build the MemoryExportApi the panel expects. Stateless — the auth token and
 * base URL are held by the `api` singleton, which the auth layer keeps current.
 *
 * Pass `signOwnerMessage` (a wallet signature over OWNER_SIGN_MESSAGE) to enable
 * register-on-demand for encrypted exports; omit it to degrade gracefully (the
 * panel then surfaces an actionable "connect your wallet" message instead).
 */
export function createPmpExportApi(signOwnerMessage?: SignOwnerMessage): MemoryExportApi {
  const adapter: MemoryExportApi = {
    preview: (selection: ExportSelection): Promise<SelectionPreview> =>
      api.pmpPreview(selection),
    export: async (req: ExportRequest): Promise<ExportResult> => {
      try {
        return await api.pmpExport(req);
      } catch (e: unknown) {
        // Normalize the singleton's holder-key error to @clude/ui's, so the panel recognizes it
        // regardless of which package's class instance it is.
        if (e instanceof HolderKeyUnregisteredError) throw new UiHolderKeyUnregisteredError();
        throw e;
      }
    },
    listArtifacts: (): Promise<PmpArtifact[]> => api.pmpListArtifacts(),
  };

  if (signOwnerMessage) {
    adapter.registerOwnerKey = async (): Promise<void> => {
      // Sign → mint the (public) registration payload → POST via the api singleton's owner-key
      // route. The signature + derived material never leave the browser; we zero the signature
      // after use (mirrors ExportScreen).
      const sig = await signOwnerMessage();
      try {
        const reg = await buildOwnerKeyRegistration(sig);
        const result = await api.registerOwnerKey(reg.x25519_pubkey, reg.verifier_ct);
        if (!result.ok) {
          // A DIFFERENT key already registered for this wallet (409) — the server refuses to orphan
          // packs sealed to the old key. Surface it; the panel won't downgrade to plaintext.
          throw new Error(
            'A different encryption key is already registered for this wallet — decrypt earlier packs with that key.',
          );
        }
      } finally {
        sig.fill(0); // zero the signature regardless of outcome (never logged/persisted)
      }
    };
  }

  return adapter;
}
