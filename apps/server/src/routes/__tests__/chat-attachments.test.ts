import { describe, it, expect, vi } from 'vitest';

// Mock dependencies that require env vars before importing the module under test
vi.mock('@clude/shared/core/database', () => ({
  getDb: vi.fn(),
}));

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  mimeToExt,
  validateAttachmentPath,
  ALLOWED_IMAGE_MIMES,
} from '../../lib/chat-attachments';

describe('mimeToExt', () => {
  it('maps known mimes', () => {
    expect(mimeToExt('image/png')).toBe('png');
    expect(mimeToExt('image/jpeg')).toBe('jpg');
    expect(mimeToExt('image/webp')).toBe('webp');
    expect(mimeToExt('image/gif')).toBe('gif');
  });
  it('throws on unknown mime', () => {
    expect(() => mimeToExt('image/heic')).toThrow();
  });
});

describe('validateAttachmentPath', () => {
  const wallet = '5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r';
  const conv = '11111111-1111-4111-8111-111111111111';
  it('accepts an in-scope path', () => {
    const ok = `${wallet}/${conv}/abcd.png`;
    expect(validateAttachmentPath(ok, wallet, conv)).toBe(true);
  });
  it('rejects another wallet', () => {
    expect(validateAttachmentPath(`OTHER/${conv}/abcd.png`, wallet, conv)).toBe(false);
  });
  it('rejects another conversation', () => {
    expect(validateAttachmentPath(`${wallet}/22222222-2222-4222-8222-222222222222/x.png`, wallet, conv)).toBe(false);
  });
  it('rejects path traversal', () => {
    expect(validateAttachmentPath(`${wallet}/${conv}/../escape.png`, wallet, conv)).toBe(false);
  });
});

describe('ALLOWED_IMAGE_MIMES', () => {
  it('does not include heic', () => {
    expect(ALLOWED_IMAGE_MIMES).not.toContain('image/heic');
  });
});
