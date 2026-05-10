import { describe, it, expect, vi } from 'vitest';

// chat.routes imports a lot of runtime config — stub the heavy bits so this test
// can read the static catalog exports without a full environment.
vi.mock('@clude/shared/core/database', () => ({ getDb: () => ({}) }));
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
vi.mock('@clude/shared/config', () => ({ config: { owner: { wallet: 'x' } } }));

import { CHAT_MODELS, getAvailableChatModels } from '../chat.routes';

describe('CHAT_MODELS vision flag', () => {
  it('flags Claude 4.6 sonnet as vision-capable', () => {
    const sonnet = CHAT_MODELS.find((m) => m.id === 'claude-sonnet-4.6');
    expect((sonnet as any)?.supportsVision).toBe(true);
  });
  it('does not flag Llama 3.3 as vision', () => {
    const llama = CHAT_MODELS.find((m) => m.id === 'llama-3.3-70b');
    expect((llama as any)?.supportsVision).toBe(false);
  });
  it('public list includes supportsVision on every entry', () => {
    for (const m of getAvailableChatModels()) {
      expect(typeof (m as any).supportsVision).toBe('boolean');
    }
  });
});
