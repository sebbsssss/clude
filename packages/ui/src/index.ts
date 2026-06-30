export { MemoryExportPanel } from './MemoryExportPanel';
export type {
  ContentCategory,
  ExportRequest,
  ExportResult,
  ExportScope,
  ExportSelection,
  MemoryExportApi,
  MemoryExportPanelProps,
  MemoryType,
  PmpArtifact,
  SelectionPreview,
} from './types';
export {
  MEMORY_TYPES,
  HOLDER_KEY_UNREGISTERED,
  HolderKeyUnregisteredError,
  isHolderKeyUnregistered,
} from './types';

// ── Browser-side .pmp crypto (tweetnacl + Web Crypto + fzstd + owner-key-constants only) ──
// Shared so BOTH apps (and the panel) register/decrypt without duplicating crypto. These modules
// MUST NOT import `@clude/shared/core/memory-envelope` (Node `crypto`); they stay browser-safe.
export { buildOwnerKeyRegistration } from './pmp/owner-key-register';
export type { OwnerKeyRegistration } from './pmp/owner-key-register';
export { deriveOwnerKeypairBrowser, decryptPmp } from './pmp/decrypt-pmp';
export type {
  DecryptedRecord,
  DecryptPmpResult,
  EncryptedRecord,
  OwnerEncryptionHeader,
  PmpManifestForDecrypt,
} from './pmp/decrypt-pmp';
export { parsePmpBase64, PmpUnreadableError, PmpZstdDecodeError } from './pmp/parse-pmp';
export type { ParsedPmp } from './pmp/parse-pmp';

// Re-export the owner-key sign-message so apps that can't depend on `@clude/shared` directly (the
// chat app) still register against the SAME fixed message the server + dashboard use. Dependency-
// free ASCII constant — browser-safe.
export { OWNER_SIGN_MESSAGE } from '@clude/shared/core/owner-key-constants';
export { runExportWithRegister, REGISTER_KEY_HINT } from './pmp/export-flow';
