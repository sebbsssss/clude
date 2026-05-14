/**
 * @clude/pmp-sdk — reference TypeScript SDK for the Portable Memory Protocol.
 *
 * Will publish to npm as @pmp/sdk once the brand domain lands.
 *
 * Quick start:
 *
 *   import { PmpClient } from '@pmp/sdk';
 *
 *   const client = new PmpClient({ baseUrl: 'https://api.portablememoryprotocol.com' });
 *   const result = await client.discover({ query: 'roadmap', limit: 10 });
 *   const memory = await client.retrieve(result.memories[0].id);
 *   const proof  = await client.verify(memory.id);
 *
 * For LangChain integration: `import { PmpMemoryStore } from '@pmp/sdk/langchain'`.
 */

export { PmpClient, type AuthHeader, type PmpClientOptions } from './client';
export { PmpError } from './errors';
export { verifyMemoryHashClientSide, type ClientSideVerifyResult } from './verify';
export {
  discoverAcrossProviders,
  type Registry,
  type RegistryProvider,
  type CrossProviderMemory,
  type CrossProviderError,
  type CrossProviderResult,
  type DiscoverAcrossProvidersOptions,
} from './discovery';
export type {
  Attestation,
  ChainId,
  ContributeOptions,
  ContributeResponse,
  DiscoverOptions,
  DiscoverResponse,
  ErrorBody,
  ErrorCode,
  Memory,
  MemoryType,
  VerifyReason,
  VerifyResponse,
} from './types';
