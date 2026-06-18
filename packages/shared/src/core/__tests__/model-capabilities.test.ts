import { describe, it, expect } from 'vitest';
import { modelRejectsSamplingParams } from '../model-capabilities';

describe('modelRejectsSamplingParams', () => {
  it('returns false for models that still accept temperature/top_p', () => {
    for (const m of [
      'claude-opus-4-6',
      'claude-opus-4.6',
      'claude-opus-4-5',
      'claude-opus-4.5',
      'claude-sonnet-4-5-20250929',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'anthropic/claude-opus-4.6',
      'meta-llama/llama-3.3-70b-instruct',
      'gpt-4o-mini',
    ]) {
      expect(modelRejectsSamplingParams(m), m).toBe(false);
    }
  });

  it('returns true for Opus 4.7+ and Opus 5+ (deprecated sampling params)', () => {
    for (const m of [
      'claude-opus-4-7',
      'claude-opus-4.7',
      'claude-opus-4-7-20260101',
      'claude-opus-4-8',
      'claude-opus-4.8',
      'anthropic/claude-opus-4.8',
      'claude-opus-4-9',
      'claude-opus-5',
      'claude-opus-5-0',
      'anthropic/claude-opus-5.1',
    ]) {
      expect(modelRejectsSamplingParams(m), m).toBe(true);
    }
  });

  it('is null / undefined / empty safe', () => {
    expect(modelRejectsSamplingParams(null)).toBe(false);
    expect(modelRejectsSamplingParams(undefined)).toBe(false);
    expect(modelRejectsSamplingParams('')).toBe(false);
  });
});
