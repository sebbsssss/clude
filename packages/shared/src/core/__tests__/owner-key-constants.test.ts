import { describe, it, expect } from 'vitest';
import {
  OWNER_SIGN_MESSAGE,
  HKDF_SALT,
  HKDF_INFO,
  VERIFIER_HKDF_INFO,
} from '../owner-key-constants.js';

describe('owner-key-constants', () => {
  it('exposes the exact owner-key constants for cross-platform parity', () => {
    expect(OWNER_SIGN_MESSAGE).toBe('clude-pmp-owner-v1');
    expect(HKDF_SALT).toBe('clude-cortex-v1');
    expect(HKDF_INFO).toBe('memory-encryption-x25519-v2');
    expect(VERIFIER_HKDF_INFO).toBe('memory-key-verifier-v1');
  });
});
