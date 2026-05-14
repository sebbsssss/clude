import { describe, expect, it } from 'vitest';
import { memoryContentHash } from '@clude/tokenization';
import { verifyMemoryHashClientSide } from '../verify';
import type { Memory } from '../types';

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: 'mem-a',
    type: 'episodic',
    content: 'remember: ship PMP',
    owner: null,
    created_at: '2026-05-13T12:00:00.000Z',
    tags: ['pmp', 'launch'],
    attestation: null,
    ...overrides,
  };
}

describe('verifyMemoryHashClientSide', () => {
  it('returns matching=false when no attestation is attached', () => {
    const result = verifyMemoryHashClientSide(memory());
    expect(result.attestedHash).toBeNull();
    expect(result.hashesMatch).toBe(false);
    expect(result.recomputedHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns matching=true when attestation hash matches recomputed', () => {
    const m = memory();
    const expected = memoryContentHash({
      content: m.content,
      memory_type: m.type,
      owner_wallet: m.owner,
      created_at: m.created_at,
      tags: m.tags,
      source: null,
      related_user: null,
      related_wallet: null,
    });
    const withAttestation: Memory = {
      ...m,
      attestation: {
        chain_id: 'solana',
        asset_id: 'pda',
        content_hash: expected,
        tx_sig: 'tx',
        tree_address: null,
        leaf_index: null,
        verifier_url: 'https://api.portablememoryprotocol.com/v1/memories/mem-a/verify',
      },
    };
    const result = verifyMemoryHashClientSide(withAttestation);
    expect(result.hashesMatch).toBe(true);
    expect(result.attestedHash).toBe(expected);
  });

  it('returns matching=false when attested hash is wrong', () => {
    const result = verifyMemoryHashClientSide({
      ...memory(),
      attestation: {
        chain_id: 'solana',
        asset_id: 'pda',
        content_hash: 'totally-wrong-hash',
        tx_sig: 'tx',
        tree_address: null,
        leaf_index: null,
        verifier_url: '',
      },
    });
    expect(result.hashesMatch).toBe(false);
    expect(result.attestedHash).toBe('totally-wrong-hash');
  });
});
