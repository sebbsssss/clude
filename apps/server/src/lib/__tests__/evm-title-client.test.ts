import { describe, it, expect } from 'vitest';
import { createEvmTitleClient, deriveTokenId, CLUDE_PACK_TITLE_ABI } from '../evm-title-client.js';

describe('EvmTitleClient', () => {
  // The deployed CludePackTitle on Base Sepolia (0xf4ED01...) returned exactly this
  // for tokenIdFor("pack-LIVE0001"). Asserting our local derivation equals it proves
  // the client and the on-chain contract agree byte-for-byte.
  it('deriveTokenId matches the on-chain CludePackTitle.tokenIdFor', () => {
    expect(deriveTokenId('pack-LIVE0001')).toBe(
      83271161582541145057325031554253387547279139063862623342171645880614481533296n,
    );
  });

  it('tokenId derivation is deterministic and pack-unique', () => {
    expect(deriveTokenId('pack-ABC')).toBe(deriveTokenId('pack-ABC'));
    expect(deriveTokenId('pack-ABC')).not.toBe(deriveTokenId('pack-XYZ'));
  });

  it('exposes the title interface with a usable contract address', () => {
    const client = createEvmTitleClient({
      rpcUrl: 'https://sepolia.base.org',
      contractAddress: '0xf4ED013433bB79B8EC7C76CCAAbeB64A7B62863a',
    });
    expect(client.contractAddress).toBe('0xf4ED013433bB79B8EC7C76CCAAbeB64A7B62863a');
    expect(client.tokenIdFor('pack-LIVE0001')).toBe(deriveTokenId('pack-LIVE0001'));
  });

  it('writes are gated on a signer key (reads are not)', async () => {
    const readOnly = createEvmTitleClient({
      rpcUrl: 'https://sepolia.base.org',
      contractAddress: '0xf4ED013433bB79B8EC7C76CCAAbeB64A7B62863a',
    });
    await expect(
      readOnly.mintTitle('0x1111111111111111111111111111111111111111', 'pack-NOKEY', {
        merkleRoot: `0x${'11'.repeat(32)}`,
        manifestHash: `0x${'22'.repeat(32)}`,
        memoryCount: 1,
        creator: '0x1111111111111111111111111111111111111111',
      }),
    ).rejects.toThrow(/requires a signer key/);
  });

  it('has a well-formed ABI for the calls the server makes', () => {
    const names = CLUDE_PACK_TITLE_ABI.map((f) => f.name).sort();
    expect(names).toEqual(['bindingOf', 'mint', 'ownerOf', 'tokenIdFor', 'transferFrom', 'verifyBinding']);
  });
});
