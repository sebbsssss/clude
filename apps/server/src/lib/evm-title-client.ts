// EvmTitleClient — the server's interface to the CludePackTitle ERC-721 on Base.
//
// This is the Base/EVM counterpart to pda-mint-client.ts (Solana). It is title-
// focused (mint / transfer / owner-read / content binding), NOT the Solana
// commitment-shaped MintClient. The $CLUDE service fee is charged separately on
// the Solana rail; this client only moves ownership on Base.
//
// Reads (titleOwner / getBinding / verifyBinding / tokenIdFor) need only an RPC.
// Writes (mintTitle / transferTitle) need a signer key:
//   - mintTitle is signed by the MINTER (the Clude server key).
//   - transferTitle is signed by the CURRENT OWNER. In the custodial-escrow saga
//     the server mints the title to itself and transfers it on sale, so the
//     server key is the owner; the non-custodial path passes the owner's signer.

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodePacked,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

const BINDING_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'merkleRoot', type: 'bytes32' },
    { name: 'manifestHash', type: 'bytes32' },
    { name: 'memoryCount', type: 'uint32' },
    { name: 'mintedAt', type: 'uint64' },
    { name: 'creator', type: 'address' },
  ],
} as const;

export const CLUDE_PACK_TITLE_ABI = [
  { type: 'function', name: 'tokenIdFor', stateMutability: 'pure', inputs: [{ name: 'packId', type: 'string' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'packId', type: 'string' }, { name: 'binding', ...BINDING_TUPLE }],
    outputs: [{ type: 'uint256' }],
  },
  { type: 'function', name: 'transferFrom', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'bindingOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: 'binding', ...BINDING_TUPLE }] },
  { type: 'function', name: 'verifyBinding', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'merkleRoot', type: 'bytes32' }, { name: 'manifestHash', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const;

export interface TitleBinding {
  merkleRoot: Hex; // 0x + 64 hex (32 bytes) — the pack's sha256-merkle-v1 root
  manifestHash: Hex;
  memoryCount: number;
  creator: Address;
}

export interface PackBindingView extends TitleBinding {
  mintedAt: number; // unix seconds, stamped on-chain at mint
}

export interface EvmTitleClientOptions {
  rpcUrl: string;
  contractAddress: Address;
  /** 84532 = Base Sepolia (default), 8453 = Base mainnet. */
  chainId?: number;
  /** Hex private key for writes (mint/transfer). Reads work without it. */
  signerKey?: Hex;
}

export interface EvmTitleClient {
  readonly contractAddress: Address;
  /** Local, contract-matching tokenId for a pack (server-precomputable). */
  tokenIdFor(packId: string): bigint;
  /** Mint the 1-of-1 title (MINTER key). Returns the tx hash + tokenId. */
  mintTitle(to: Address, packId: string, binding: TitleBinding): Promise<{ txHash: Hex; tokenId: bigint }>;
  /** Transfer a title. Signed by the CURRENT OWNER (custodial escrow: the server). */
  transferTitle(from: Address, to: Address, tokenId: bigint): Promise<{ txHash: Hex }>;
  /** Current single owner, or null if the title does not exist. */
  titleOwner(tokenId: bigint): Promise<Address | null>;
  /** The on-chain content commitment, or null if the title does not exist. */
  getBinding(tokenId: bigint): Promise<PackBindingView | null>;
  /** Does the title commit to the given pack content? */
  verifyBinding(tokenId: bigint, merkleRoot: Hex, manifestHash: Hex): Promise<boolean>;
}

/** Local tokenId derivation, byte-identical to CludePackTitle.tokenIdFor. */
export function deriveTokenId(packId: string): bigint {
  return BigInt(keccak256(encodePacked(['string', 'string'], ['clude-pmp-title:v1:', packId])));
}

export function createEvmTitleClient(opts: EvmTitleClientOptions): EvmTitleClient {
  const chain = opts.chainId === 8453 ? base : baseSepolia;
  const contractAddress = getAddress(opts.contractAddress);

  const publicClient = createPublicClient({ chain, transport: http(opts.rpcUrl) });
  const account = opts.signerKey ? privateKeyToAccount(opts.signerKey) : undefined;
  const walletClient = account
    ? createWalletClient({ account, chain, transport: http(opts.rpcUrl) })
    : undefined;

  function requireWallet(action: string) {
    if (!walletClient || !account) throw new Error(`EvmTitleClient: ${action} requires a signer key`);
    return walletClient;
  }

  /** ERC-721 reverts (e.g. ERC721NonexistentToken) on owner/binding reads of a
   *  missing token; map those to null rather than throwing. */
  async function readOrNull<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      const msg = (err as Error)?.message ?? '';
      if (/Nonexistent|owner query for nonexistent|reverted/i.test(msg)) return null;
      throw err;
    }
  }

  return {
    contractAddress,

    tokenIdFor: deriveTokenId,

    async mintTitle(to, packId, binding) {
      const w = requireWallet('mintTitle');
      const tokenId = deriveTokenId(packId);
      const txHash = await w.writeContract({
        account: account!,
        chain,
        address: contractAddress,
        abi: CLUDE_PACK_TITLE_ABI,
        functionName: 'mint',
        args: [
          getAddress(to),
          packId,
          {
            merkleRoot: binding.merkleRoot,
            manifestHash: binding.manifestHash,
            memoryCount: binding.memoryCount,
            mintedAt: 0n, // ignored by the contract; stamped from block.timestamp
            creator: getAddress(binding.creator),
          },
        ],
      });
      return { txHash, tokenId };
    },

    async transferTitle(from, to, tokenId) {
      const w = requireWallet('transferTitle');
      const txHash = await w.writeContract({
        account: account!,
        chain,
        address: contractAddress,
        abi: CLUDE_PACK_TITLE_ABI,
        functionName: 'transferFrom',
        args: [getAddress(from), getAddress(to), tokenId],
      });
      return { txHash };
    },

    async titleOwner(tokenId) {
      return readOrNull(async () => {
        const owner = await publicClient.readContract({
          address: contractAddress,
          abi: CLUDE_PACK_TITLE_ABI,
          functionName: 'ownerOf',
          args: [tokenId],
        });
        return getAddress(owner);
      });
    },

    async getBinding(tokenId) {
      return readOrNull(async () => {
        const b = await publicClient.readContract({
          address: contractAddress,
          abi: CLUDE_PACK_TITLE_ABI,
          functionName: 'bindingOf',
          args: [tokenId],
        });
        return {
          merkleRoot: b.merkleRoot,
          manifestHash: b.manifestHash,
          memoryCount: Number(b.memoryCount),
          mintedAt: Number(b.mintedAt),
          creator: getAddress(b.creator),
        };
      });
    },

    async verifyBinding(tokenId, merkleRoot, manifestHash) {
      return publicClient.readContract({
        address: contractAddress,
        abi: CLUDE_PACK_TITLE_ABI,
        functionName: 'verifyBinding',
        args: [tokenId, merkleRoot, manifestHash],
      });
    },
  };
}
