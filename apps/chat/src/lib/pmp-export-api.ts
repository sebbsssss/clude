// Adapter binding the @clude/ui MemoryExportPanel to the chat app.
//
// AUTH: the chat app's main API client authenticates with a Cortex clk_ key, but
// the /v1/pmp/* export endpoints require a PRIVY JWT (requirePrivyAuth +
// requireOwnership). So this adapter sends the user's Privy ACCESS TOKEN as the
// Bearer credential — never the cortex key (which would 401). The backend
// derives the owner wallet from the verified Privy identity, so no ?wallet= is
// needed (and a client-supplied one is never trusted).
//
// ENCRYPT-BY-DEFAULT: /v1/pmp/export fails CLOSED (422 `holder_key_unregistered`)
// until the owner registers their encryption key. `export()` surfaces that case as
// the recognizable HolderKeyUnregisteredError so the panel can register-on-demand,
// and `registerOwnerKey()` runs the full sign → build payload → POST flow using the
// chat's Solana wallet signature over OWNER_SIGN_MESSAGE.

import {
  buildOwnerKeyRegistration,
  HolderKeyUnregisteredError,
  HOLDER_KEY_UNREGISTERED,
  OWNER_SIGN_MESSAGE,
} from '@clude/ui';
import type {
  ExportRequest,
  ExportResult,
  ExportSelection,
  MemoryExportApi,
  PmpArtifact,
  SelectionPreview,
} from '@clude/ui';

type GetToken = () => Promise<string | null>;
/** Sign arbitrary bytes with a specific Solana wallet (chat's useSolanaWallet.signMessage). */
type SignMessage = (message: Uint8Array, walletAddress: string) => Promise<Uint8Array>;

async function readError(res: Response): Promise<{ message: string; code?: string }> {
  try {
    const j = (await res.json()) as { error?: string; hint?: string };
    if (j?.error) {
      return { message: j.hint ? `${j.error}: ${j.hint}` : j.error, code: j.error };
    }
  } catch {
    // non-JSON error body; fall through to the status message
  }
  return { message: `Request failed (${res.status})` };
}

async function authed<T>(getToken: GetToken, path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error('Sign in to export your memories');
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error((await readError(res)).message);
  }
  return (await res.json()) as T;
}

/**
 * Build the MemoryExportApi the panel expects, authenticated with the caller's
 * Privy token. Pass usePrivy().getAccessToken (or useSolanaWallet().getAccessToken)
 * as `getToken`, plus the chat wallet's `signMessage` + the connected `walletAddress`
 * so the panel can register the owner key on-demand for encrypted exports.
 */
export function createPmpExportApi(
  getToken: GetToken,
  signMessage?: SignMessage,
  walletAddress?: string | null,
): MemoryExportApi {
  const api: MemoryExportApi = {
    preview: (selection: ExportSelection): Promise<SelectionPreview> =>
      authed(getToken, '/v1/pmp/export/preview', { selection }),
    export: async (req: ExportRequest): Promise<ExportResult> => {
      const token = await getToken();
      if (!token) throw new Error('Sign in to export your memories');
      // Inline fetch (not the `authed` helper) so a 422 `holder_key_unregistered` body can be read
      // and surfaced as the recognizable error the panel catches to register-on-demand + retry.
      const res = await fetch('/v1/pmp/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(req),
      });
      if (res.ok) return (await res.json()) as ExportResult;
      const { message, code } = await readError(res);
      if (res.status === 422 && code === HOLDER_KEY_UNREGISTERED) {
        throw new HolderKeyUnregisteredError();
      }
      throw new Error(message);
    },
    listArtifacts: async (): Promise<PmpArtifact[]> => {
      const r = await authed<{ artifacts: PmpArtifact[] }>(getToken, '/v1/pmp/artifacts');
      return r.artifacts ?? [];
    },
  };

  // Only expose register-on-demand when we actually have a wallet to sign with. The panel checks
  // for `registerOwnerKey` and, when absent, surfaces an actionable "connect your wallet" message
  // instead of looping — so omitting it here is the correct degraded behavior.
  if (signMessage && walletAddress) {
    api.registerOwnerKey = async (): Promise<void> => {
      const token = await getToken();
      if (!token) throw new Error('Sign in to register your encryption key');
      // Sign the fixed OWNER_SIGN_MESSAGE → mint the (public) registration payload → POST it. The
      // signature + derived material never leave the browser; we zero the signature after use.
      const sig = await signMessage(new TextEncoder().encode(OWNER_SIGN_MESSAGE), walletAddress);
      try {
        const reg = await buildOwnerKeyRegistration(sig);
        const res = await fetch('/v1/encryption/owner-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ x25519_pubkey: reg.x25519_pubkey, verifier_ct: reg.verifier_ct }),
        });
        if (!res.ok) {
          // A 409 means a DIFFERENT key is already registered for this wallet — the server refuses to
          // orphan packs sealed to the old key. Surface it; the panel won't downgrade to plaintext.
          if (res.status === 409) {
            throw new Error(
              'A different encryption key is already registered for this wallet — decrypt earlier packs with that key.',
            );
          }
          throw new Error((await readError(res)).message);
        }
      } finally {
        sig.fill(0); // zero the signature regardless of outcome (never logged/persisted)
      }
    };
  }

  return api;
}
