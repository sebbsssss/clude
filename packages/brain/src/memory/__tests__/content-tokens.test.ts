import { describe, it, expect, vi } from 'vitest';
import { setContentTokens } from '../content-tokens';

function fakeDb(rpcImpl: (...args: any[]) => any) {
  return { rpc: vi.fn(rpcImpl) } as any;
}

describe('setContentTokens', () => {
  it('calls set_memory_content_tokens with the memory id and plaintext', async () => {
    const db = fakeDb(async () => ({ error: null }));
    await setContentTokens(db, 42, 'hello plaintext');
    expect(db.rpc).toHaveBeenCalledWith('set_memory_content_tokens', {
      p_memory_id: 42,
      p_text: 'hello plaintext',
    });
  });

  it('does not throw when the RPC returns an error (tolerant, logs)', async () => {
    const db = fakeDb(async () => ({ error: { message: 'no such function' } }));
    await expect(setContentTokens(db, 1, 'x')).resolves.toBeUndefined();
  });

  it('does not throw when the RPC rejects', async () => {
    const db = fakeDb(async () => { throw new Error('network'); });
    await expect(setContentTokens(db, 1, 'x')).resolves.toBeUndefined();
  });
});
