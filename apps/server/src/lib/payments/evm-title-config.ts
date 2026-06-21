/**
 * evm-title-config — resolve the Base CludePackTitle client from env, with a hard mainnet gate.
 *
 * Three flavours of EvmTitleClient, by what they need to SIGN:
 *   - read-only  (ownerOf / binding / tokenId): no signer. The unlock gate + reconciliation use this.
 *   - minter     (mint): signs with BASE_MINTER_KEY (the Clude MINTER_ROLE key).
 *   - owner-signed (transferFrom): signs with a CUSTODIAL OWNER key injected by the caller — the
 *     saga's transfer step needs the SELLER's custodial key (base-identity.ts), because the contract
 *     has no operator god-transfer.
 *
 * SEC-1 MAINNET GATE (enforced in code, not just docs): resolving a Base MAINNET (chainId 8453)
 * client THROWS unless ALLOW_BASE_MAINNET === 'true'. Mainnet is blocked until the securities
 * sign-off flips that flag — a transferable title on mainnet is the Howey-sensitive surface. Base
 * Sepolia (84532, the default) is always allowed.
 *
 * Env:
 *   CLUDE_PACK_TITLE_ADDRESS  (required) the deployed contract address
 *   BASE_RPC_URL              (default https://sepolia.base.org)
 *   BASE_CHAIN_ID             (default 84532; only 84532 | 8453 accepted)
 *   BASE_MINTER_KEY           (required only for getMinterEvmTitleClient)
 *   ALLOW_BASE_MAINNET        ('true' unlocks chainId 8453 — SEC-1)
 */

import { getAddress, type Address, type Hex } from 'viem';
import { createEvmTitleClient, type EvmTitleClient } from '../evm-title-client.js';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('evm-title-config');

const DEFAULT_RPC = 'https://sepolia.base.org';
const BASE_SEPOLIA = 84532;
const BASE_MAINNET = 8453;
const DEFAULT_CHAIN_ID = BASE_SEPOLIA;

export interface EvmTitleEnv {
  rpcUrl: string;
  contractAddress: Address;
  chainId: number;
}

/** Resolve + validate the Base title config from env. Throws on a missing/invalid contract address,
 *  a bad chain id, or an un-gated mainnet. `env` is injectable for tests. */
export function resolveEvmTitleEnv(env: NodeJS.ProcessEnv = process.env): EvmTitleEnv {
  const contract = env.CLUDE_PACK_TITLE_ADDRESS?.trim();
  if (!contract) {
    throw new Error('CLUDE_PACK_TITLE_ADDRESS is not set (the deployed CludePackTitle contract address)');
  }
  let contractAddress: Address;
  try {
    contractAddress = getAddress(contract);
  } catch {
    throw new Error(`CLUDE_PACK_TITLE_ADDRESS is not a valid EVM address: ${contract}`);
  }

  const rpcUrl = env.BASE_RPC_URL?.trim() || DEFAULT_RPC;

  const chainId = env.BASE_CHAIN_ID ? Number(env.BASE_CHAIN_ID) : DEFAULT_CHAIN_ID;
  if (chainId !== BASE_SEPOLIA && chainId !== BASE_MAINNET) {
    throw new Error(`BASE_CHAIN_ID must be ${BASE_SEPOLIA} (Base Sepolia) or ${BASE_MAINNET} (Base mainnet); got ${env.BASE_CHAIN_ID}`);
  }

  // SEC-1: refuse mainnet unless explicitly unlocked after the securities sign-off.
  if (chainId === BASE_MAINNET && env.ALLOW_BASE_MAINNET !== 'true') {
    throw new Error(
      'Base MAINNET (8453) is gated behind SEC-1: set ALLOW_BASE_MAINNET=true only after the securities sign-off. Refusing to build a mainnet title client.',
    );
  }

  return { rpcUrl, contractAddress, chainId };
}

let readClient: EvmTitleClient | null = null;

/** Memoized READ-ONLY client (ownerOf / binding / tokenId). The unlock gate + reconciliation use it. */
export function getReadOnlyEvmTitleClient(): EvmTitleClient {
  if (readClient) return readClient;
  const env = resolveEvmTitleEnv();
  readClient = createEvmTitleClient({ rpcUrl: env.rpcUrl, contractAddress: env.contractAddress, chainId: env.chainId });
  log.info({ chainId: env.chainId, contract: env.contractAddress }, 'EvmTitleClient (read-only) resolved');
  return readClient;
}

/** The MINTER client (signs mint with BASE_MINTER_KEY). Throws if the minter key is absent. */
export function getMinterEvmTitleClient(): EvmTitleClient {
  const env = resolveEvmTitleEnv();
  const key = process.env.BASE_MINTER_KEY?.trim() as Hex | undefined;
  if (!key) throw new Error('BASE_MINTER_KEY is not set (required to mint titles)');
  return createEvmTitleClient({ ...env, signerKey: key });
}

/** A client that SIGNS AS a specific custodial owner — the saga's transfer step passes the SELLER's
 *  custodial signerKey here so transferFrom(seller, buyer) is authorized. */
export function getOwnerSignedEvmTitleClient(signerKey: Hex): EvmTitleClient {
  if (!signerKey) throw new Error('getOwnerSignedEvmTitleClient: a signerKey is required');
  const env = resolveEvmTitleEnv();
  return createEvmTitleClient({ ...env, signerKey });
}

/** Test-only: drop the memoized read client so a different env can be installed. */
export function __resetEvmTitleClientsForTests(): void {
  readClient = null;
}
