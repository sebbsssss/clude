// Shared contract for the memory-export panel. Browser-safe types only — no
// backend imports. Each app supplies the `api` implementation (wired to its own
// authenticated client), so this package never touches fetch/Privy directly.

export type MemoryType =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'self_model'
  | 'introspective';

export const MEMORY_TYPES: MemoryType[] = [
  'episodic',
  'semantic',
  'procedural',
  'self_model',
  'introspective',
];

/** How the user chose which memories to pack. */
export type ExportScope = 'all' | 'type' | 'tag' | 'range' | 'pack';

/** Personal stays private; knowledge is listable; agent is portable agent memory. */
export type ContentCategory = 'personal' | 'knowledge' | 'agent';

/** The selection the panel sends to the server to gather memories for a pack. */
export interface ExportSelection {
  scope: ExportScope;
  /** scope === 'type' */
  types?: MemoryType[];
  /** scope === 'tag' */
  tags?: string[];
  /** scope === 'range' — ISO dates (inclusive) */
  from?: string;
  to?: string;
  /** scope === 'pack' */
  pack_id?: string;
}

/** Lightweight preview the panel renders before committing to an export. */
export interface SelectionPreview {
  total: number;
  by_type: Partial<Record<MemoryType, number>>;
  /** How many items the secret/PII filter would hold back (optional). */
  flagged?: number;
}

export interface ExportRequest {
  selection: ExportSelection;
  name: string;
  description?: string;
  category: ContentCategory;
  encrypt: boolean;
  /** Pack scope only: mint a 1-of-1 Base ownership title for the (owned, tokenised) pack on export. */
  mint_as_title?: boolean;
}

/** A `.pmp` artifact as returned by POST /v1/pmp/export. */
export interface PmpArtifact {
  artifact_id: string;
  title: string;
  record_count: number;
  merkle_root: string;
  byte_size: number | null;
  created_at: string;
  license_type?: 'copy' | 'title';
}

export interface ExportResult {
  artifact: PmpArtifact;
  /** The .pmp file bytes (base64), returned inline so the client saves the file directly — no
   *  server-side blob storage and no dangling /download URL. */
  pmp_base64?: string;
  /** Suggested download filename, e.g. "my-pack.pmp". */
  filename?: string;
  /** @deprecated the server no longer returns a download URL; downloads are served inline via pmp_base64. */
  download?: string;
  /** true when this exact pack was already registered (idempotent re-export). */
  deduped?: boolean;
}

/**
 * The API surface the panel needs. Implemented per-app against the live
 * /v1/pmp/* endpoints. `preview` should be cheap (count only).
 */
export interface MemoryExportApi {
  preview(selection: ExportSelection): Promise<SelectionPreview>;
  export(req: ExportRequest): Promise<ExportResult>;
  listArtifacts?(): Promise<PmpArtifact[]>;
}

export interface MemoryExportPanelProps {
  api: MemoryExportApi;
  /** The caller's wallet, shown as the pack creator. */
  walletAddress?: string | null;
  /** Visual theme. 'auto' follows prefers-color-scheme. Default 'auto'. */
  theme?: 'light' | 'dark' | 'auto';
  /** Extra class on the root for per-app layout (margins, width). */
  className?: string;
  /** Tags the user can quick-pick in the "By tag" scope (e.g. their top tags). */
  suggestedTags?: string[];
  /** Saved packs the user can export directly (scope 'pack'). */
  savedPacks?: { pack_id: string; name: string; count?: number }[];
  /** Fired after a successful export, before the default download. */
  onExported?: (result: ExportResult) => void;
  /** Override the download action (default: open result.download). */
  onDownload?: (artifact: PmpArtifact, downloadUrl: string) => void;
  /** Wire the "Send to Clude desktop" action (device pairing). Hidden if absent. */
  onSendToDesktop?: (artifact: PmpArtifact) => void;
  /** Wire the "List on marketplace" action. Hidden if absent. Disabled for personal packs. */
  onListOnMarketplace?: (artifact: PmpArtifact) => void;
}
