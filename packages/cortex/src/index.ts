// ============================================================
// @clude/cortex — The integration layer
//
// Private. Portable. Permissionless. Poly-model. Persistent.
//
// Cortex connects Brain to the world:
//   - Wallet-based identity
//   - Signed MemoryPacks (export/import/merge)
//   - On-chain proofs (Solana)
//   - Framework adapters (OpenAI, LangChain, CrewAI)
//   - Markdown/JSON export
// ============================================================

// Identity
export {
  generateMemoryUUID,
  generateAgentId,
  type AgentIdentity,
  type AgentProfile,
} from './identity.js';

// MemoryPacks
export {
  createPack,
  mergePacks,
  computeContentHash,
  signPackHMAC,
  verifyPackIntegrity,
  verifyPackHMAC,
  packToMarkdown,
  packToJSON,
  packFromJSON,
  type MemoryPack,
  type PortableMemory,
  type PortableConnection,
  type PortableEntity,
  type PortableRelation,
  type MemoryType,
  type ConnectionType,
} from './pack.js';
