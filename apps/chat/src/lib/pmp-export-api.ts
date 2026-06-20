// Adapter binding the @clude/ui MemoryExportPanel to the chat app.
//
// AUTH: the chat app's main API client authenticates with a Cortex clk_ key, but
// the /v1/pmp/* export endpoints require a PRIVY JWT (requirePrivyAuth +
// requireOwnership). So this adapter sends the user's Privy ACCESS TOKEN as the
// Bearer credential — never the cortex key (which would 401). The backend
// derives the owner wallet from the verified Privy identity, so no ?wallet= is
// needed (and a client-supplied one is never trusted).

import type {
  ExportRequest,
  ExportResult,
  ExportSelection,
  MemoryExportApi,
  PmpArtifact,
  SelectionPreview,
} from '@clude/ui';

type GetToken = () => Promise<string | null>;

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
    let message = `Request failed (${res.status})`;
    try {
      const j = (await res.json()) as { error?: string; hint?: string };
      if (j?.error) message = j.hint ? `${j.error}: ${j.hint}` : j.error;
    } catch {
      // non-JSON error body; keep the status message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/**
 * Build the MemoryExportApi the panel expects, authenticated with the caller's
 * Privy token. Pass usePrivy().getAccessToken as `getToken`.
 */
export function createPmpExportApi(getToken: GetToken): MemoryExportApi {
  return {
    preview: (selection: ExportSelection): Promise<SelectionPreview> =>
      authed(getToken, '/v1/pmp/export/preview', { selection }),
    export: (req: ExportRequest): Promise<ExportResult> => authed(getToken, '/v1/pmp/export', req),
    listArtifacts: async (): Promise<PmpArtifact[]> => {
      const r = await authed<{ artifacts: PmpArtifact[] }>(getToken, '/v1/pmp/artifacts');
      return r.artifacts ?? [];
    },
  };
}
