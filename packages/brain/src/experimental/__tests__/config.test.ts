import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getExperimentalConfig } from '../config';

describe('config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getExperimentalConfig', () => {
    it('returns defaults when no env vars set', () => {
      delete process.env.EXP_TEMPORAL_BONDS;
      delete process.env.EXP_RERANKING;
      delete process.env.EXP_CONFIDENCE_GATE;
      delete process.env.EXP_RRF_MERGE;
      delete process.env.EXP_BM25_SEARCH;
      delete process.env.EXP_IRCOT;
      delete process.env.EXP_RERANK_PROVIDER;
      delete process.env.COHERE_API_KEY;
      delete process.env.EMBEDDING_API_KEY;
      delete process.env.VOYAGE_API_KEY;
      delete process.env.EXP_CONFIDENCE_THRESHOLD;
      delete process.env.EXP_IRCOT_MAX_STEPS;

      const config = getExperimentalConfig();
      expect(config.temporalBonds).toBe(true);
      expect(config.reranking).toBe(false);
      expect(config.confidenceGate).toBe(false);
      expect(config.rrfMerge).toBe(false);
      expect(config.bm25Search).toBe(false);
      expect(config.ircot).toBe(false);
      expect(config.rerankProvider).toBe('voyage');
      expect(config.cohereApiKey).toBe('');
      expect(config.voyageApiKey).toBe('');
      expect(config.confidenceThreshold).toBe(0.4);
      expect(config.ircotMaxSteps).toBe(3);
    });

    it('respects env var overrides', () => {
      process.env.EXP_TEMPORAL_BONDS = 'false';
      process.env.EXP_RERANKING = 'true';
      process.env.EXP_CONFIDENCE_GATE = 'false';
      process.env.EXP_RRF_MERGE = '1';
      process.env.EXP_RERANK_PROVIDER = 'cohere';
      process.env.COHERE_API_KEY = 'test-cohere-key';
      process.env.EMBEDDING_API_KEY = 'test-voyage-key';
      process.env.EXP_CONFIDENCE_THRESHOLD = '0.7';
      process.env.EXP_IRCOT_MAX_STEPS = '5';

      const config = getExperimentalConfig();
      expect(config.temporalBonds).toBe(false);
      expect(config.reranking).toBe(true);
      expect(config.confidenceGate).toBe(false);
      expect(config.rrfMerge).toBe(true);
      expect(config.rerankProvider).toBe('cohere');
      expect(config.cohereApiKey).toBe('test-cohere-key');
      expect(config.voyageApiKey).toBe('test-voyage-key');
      expect(config.confidenceThreshold).toBe(0.7);
      expect(config.ircotMaxSteps).toBe(5);
    });

    it('prefers EMBEDDING_API_KEY over VOYAGE_API_KEY', () => {
      process.env.EMBEDDING_API_KEY = 'embed-key';
      process.env.VOYAGE_API_KEY = 'voyage-key';

      const config = getExperimentalConfig();
      expect(config.voyageApiKey).toBe('embed-key');
    });

    it('falls back to VOYAGE_API_KEY when EMBEDDING_API_KEY not set', () => {
      delete process.env.EMBEDDING_API_KEY;
      process.env.VOYAGE_API_KEY = 'voyage-key';

      const config = getExperimentalConfig();
      expect(config.voyageApiKey).toBe('voyage-key');
    });
  });
});
