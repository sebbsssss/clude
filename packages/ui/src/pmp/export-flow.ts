// Register-on-demand export flow — the load-bearing control logic the MemoryExportPanel uses when
// encryption-by-default fails closed. Extracted as a pure async function so it is unit-testable
// without a DOM: given an `api` (export + optional registerOwnerKey) and the request, it runs the
// export, and on a `holder_key_unregistered` rejection registers the owner key ONCE and retries.
//
// Invariants:
//   - At most ONE retry (no loop).
//   - NEVER downgrades to plaintext silently: when registration is unavailable or fails, it throws
//     an actionable error the caller surfaces to the user.

import type { ExportRequest, ExportResult, MemoryExportApi } from '../types';
import { isHolderKeyUnregistered } from '../types';

/** Actionable message shown when an encrypted export needs a key but we can't register one. */
export const REGISTER_KEY_HINT =
  'Register your encryption key to export encrypted — connect your wallet and approve the signature.';

/**
 * Run `api.export(req)`. If it rejects with the holder-key-unregistered signal AND the export was
 * encrypted, register the owner key on-demand and retry exactly once.
 *
 * @param api      the panel's injected API (must implement `export`; `registerOwnerKey` optional).
 * @param req      the export request (its `encrypt` flag gates the register-on-demand path).
 * @throws an actionable Error when registration is unavailable/declined, or rethrows a non-recoverable error.
 */
export async function runExportWithRegister(
  api: Pick<MemoryExportApi, 'export' | 'registerOwnerKey'>,
  req: ExportRequest,
): Promise<ExportResult> {
  try {
    return await api.export(req);
  } catch (err: unknown) {
    // Only the encrypted-export, holder-key-unregistered case is recoverable.
    if (!req.encrypt || !isHolderKeyUnregistered(err)) throw err;

    if (!api.registerOwnerKey) {
      throw new Error(REGISTER_KEY_HINT);
    }
    try {
      await api.registerOwnerKey();
    } catch (regErr: unknown) {
      const why = regErr instanceof Error ? regErr.message : String(regErr);
      throw new Error(
        `Couldn’t register your encryption key — connect your wallet and approve the signature, then export again. (${why})`,
      );
    }
    // Retry exactly once after a successful registration.
    return api.export(req);
  }
}
