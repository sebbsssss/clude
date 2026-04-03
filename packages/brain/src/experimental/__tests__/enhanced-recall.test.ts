import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies before importing
vi.mock('../../memory', () => ({
  recallMemories: vi.fn(),
  formatMemoryContext: vi.fn((memories: any[]) =>
    memories.map(m => m.summary).join('\n')
  ),
}));

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../config', () => ({
  getExperimentalConfig: vi.fn(() => ({
    temporalBonds: true,
    reranking: false,
    confidenceGate: true,
    rrfMerge: false,
    bm25Search: false,
    ircot: false,
    rerankProvider: 'voyage',
    cohereApiKey: '',
    voyageApiKey: '',
    confidenceThreshold: 0.4,
    ircotMaxSteps: 3,
  })),
}));

vi.mock('../reranker', () => ({
  rerankWithCrossEncoder: vi.fn(async (memories: any[]) => memories),
  rerankWithVoyage: vi.fn(async (memories: any[]) => memories),
}));

vi.mock('../confidence-gate', () => ({
  evaluateConfidence: vi.fn((memories: any[]) => ({
    score: memories.length > 0 ? 0.7 : 0,
    sufficient: memories.length > 0,
    components: { coverage: 1, topScore: 0.8, diversity: 0.5, agreement: 0.6 },
  })),
  filterLowConfidenceMemories: vi.fn((memories: any[]) => memories),
}));

vi.mock('../ircot', () => ({
  runIRCoT: vi.fn(),
  isMultiHopQuery: vi.fn(() => false),
}));

vi.mock('../temporal-bonds', () => ({
  TEMPORAL_BOND_TYPE_WEIGHTS: {
    causes: 1.0,
    supports: 0.9,
    concurrent_with: 0.8,
  },
}));

import { enhancedRecallMemories, buildEnhancedContext } from '../enhanced-recall';
import { recallMemories } from '../../memory';
import { getExperimentalConfig } from '../config';
import { rerankWithCrossEncoder, rerankWithVoyage } from '../reranker';
import { isMultiHopQuery, runIRCoT } from '../ircot';

function makeMemory(id: number, score: number) {
  return {
    id,
    _score: score,
    summary: `Memory ${id}`,
    content: `Content ${id}`,
    memory_type: 'episodic',
    hash_id: `hash-${id}`,
    tags: [],
    concepts: [],
    emotional_valence: 0,
    importance: 0.5,
    access_count: 1,
    source: 'test',
    source_id: null,
    related_user: null,
    related_wallet: null,
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    last_accessed: '2026-01-01T00:00:00Z',
    decay_factor: 1.0,
    evidence_ids: [],
    solana_signature: null,
    compacted: false,
    compacted_into: null,
    encrypted: false,
    encryption_pubkey: null,
  };
}

describe('enhanced-recall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (recallMemories as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeMemory(1, 0.9),
      makeMemory(2, 0.8),
    ]);
  });

  describe('enhancedRecallMemories', () => {
    it('calls recallMemories with provided opts', async () => {
      const opts = { query: 'test', limit: 5 };
      await enhancedRecallMemories(opts);
      expect(recallMemories).toHaveBeenCalledWith(opts);
    });

    it('returns memories and confidence result', async () => {
      const result = await enhancedRecallMemories({ query: 'test' });
      expect(result.memories).toHaveLength(2);
      expect(result.confidence).toBeDefined();
      expect(result.confidence.score).toBeGreaterThan(0);
      expect(result.activeExperiments).toBeInstanceOf(Array);
    });

    it('activates confidence gate when enabled', async () => {
      const result = await enhancedRecallMemories({ query: 'test' });
      expect(result.activeExperiments).toContain('confidence-gate');
    });

    it('activates IRCoT for multi-hop queries when enabled', async () => {
      (getExperimentalConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        temporalBonds: true,
        reranking: false,
        confidenceGate: true,
        rrfMerge: false,
        bm25Search: false,
        ircot: true,
        rerankProvider: 'voyage',
        cohereApiKey: '',
        voyageApiKey: '',
        confidenceThreshold: 0.4,
        ircotMaxSteps: 3,
      });
      (isMultiHopQuery as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (runIRCoT as ReturnType<typeof vi.fn>).mockResolvedValue({
        memories: [makeMemory(1, 0.9), makeMemory(2, 0.8), makeMemory(3, 0.7)],
        iterations: 2,
        reasoningChain: ['step1', 'step2'],
        earlyStop: false,
      });

      const llmCallFn = vi.fn();
      const result = await enhancedRecallMemories({ query: 'What did Alice say about Bob?' }, llmCallFn);
      expect(result.activeExperiments).toContain('ircot');
      expect(result.ircotIterations).toBe(2);
      expect(runIRCoT).toHaveBeenCalled();
    });

    it('skips IRCoT when no llmCallFn provided', async () => {
      (getExperimentalConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        temporalBonds: true,
        reranking: false,
        confidenceGate: true,
        rrfMerge: false,
        bm25Search: false,
        ircot: true,
        rerankProvider: 'voyage',
        cohereApiKey: '',
        voyageApiKey: '',
        confidenceThreshold: 0.4,
        ircotMaxSteps: 3,
      });
      (isMultiHopQuery as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const result = await enhancedRecallMemories({ query: 'What did Alice say about Bob?' });
      expect(result.activeExperiments).not.toContain('ircot');
      expect(runIRCoT).not.toHaveBeenCalled();
    });

    it('activates Cohere reranking when configured', async () => {
      (getExperimentalConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        temporalBonds: true,
        reranking: true,
        confidenceGate: false,
        rrfMerge: false,
        bm25Search: false,
        ircot: false,
        rerankProvider: 'cohere',
        cohereApiKey: 'test-key',
        voyageApiKey: '',
        confidenceThreshold: 0.4,
        ircotMaxSteps: 3,
      });

      const result = await enhancedRecallMemories({ query: 'test' });
      expect(result.activeExperiments).toContain('reranking-cohere');
      expect(rerankWithCrossEncoder).toHaveBeenCalled();
    });

    it('activates Voyage reranking when configured', async () => {
      (getExperimentalConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        temporalBonds: true,
        reranking: true,
        confidenceGate: false,
        rrfMerge: false,
        bm25Search: false,
        ircot: false,
        rerankProvider: 'voyage',
        cohereApiKey: '',
        voyageApiKey: 'voyage-key',
        confidenceThreshold: 0.4,
        ircotMaxSteps: 3,
      });

      const result = await enhancedRecallMemories({ query: 'test' });
      expect(result.activeExperiments).toContain('reranking-voyage');
      expect(rerankWithVoyage).toHaveBeenCalled();
    });

    it('skips reranking for preference-style queries', async () => {
      (getExperimentalConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        temporalBonds: true,
        reranking: true,
        confidenceGate: false,
        rrfMerge: false,
        bm25Search: false,
        ircot: false,
        rerankProvider: 'voyage',
        cohereApiKey: '',
        voyageApiKey: 'voyage-key',
        confidenceThreshold: 0.4,
        ircotMaxSteps: 3,
      });

      // Preference keywords should bypass reranking
      for (const query of [
        'What does the user prefer for dinner?',
        'What is their favorite restaurant?',
        'Do they like Italian food?',
        'Any recommendations they mentioned?',
      ]) {
        vi.clearAllMocks();
        (recallMemories as ReturnType<typeof vi.fn>).mockResolvedValue([
          makeMemory(1, 0.9),
          makeMemory(2, 0.8),
        ]);
        const result = await enhancedRecallMemories({ query });
        expect(result.activeExperiments).not.toContain('reranking-voyage');
        expect(rerankWithVoyage).not.toHaveBeenCalled();
      }
    });

    it('still reranks non-preference queries when reranking enabled', async () => {
      (getExperimentalConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        temporalBonds: true,
        reranking: true,
        confidenceGate: false,
        rrfMerge: false,
        bm25Search: false,
        ircot: false,
        rerankProvider: 'voyage',
        cohereApiKey: '',
        voyageApiKey: 'voyage-key',
        confidenceThreshold: 0.4,
        ircotMaxSteps: 3,
      });

      const result = await enhancedRecallMemories({ query: 'When did Alice visit Paris?' });
      expect(result.activeExperiments).toContain('reranking-voyage');
      expect(rerankWithVoyage).toHaveBeenCalled();
    });

    it('returns empty activeExperiments when no experiments enabled', async () => {
      (getExperimentalConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        temporalBonds: false,
        reranking: false,
        confidenceGate: false,
        rrfMerge: false,
        bm25Search: false,
        ircot: false,
        rerankProvider: 'voyage',
        cohereApiKey: '',
        voyageApiKey: '',
        confidenceThreshold: 0.4,
        ircotMaxSteps: 3,
      });

      const result = await enhancedRecallMemories({ query: 'test' });
      expect(result.activeExperiments).toEqual([]);
    });
  });

  describe('buildEnhancedContext', () => {
    it('returns memory context and hedging instruction', () => {
      const memories = [makeMemory(1, 0.9)] as any;
      const confidence = {
        score: 0.2,
        sufficient: false,
        components: { coverage: 0.3, topScore: 0.2, diversity: 0.1, agreement: 0.1 },
        hedgingInstruction: 'Be careful',
      };
      const result = buildEnhancedContext(memories, confidence);
      expect(result.memoryContext).toBeDefined();
      expect(result.hedgingInstruction).toBe('Be careful');
    });

    it('returns no hedging when confidence is sufficient', () => {
      const memories = [makeMemory(1, 0.9)] as any;
      const confidence = {
        score: 0.8,
        sufficient: true,
        components: { coverage: 1, topScore: 0.9, diversity: 0.8, agreement: 0.7 },
      };
      const result = buildEnhancedContext(memories, confidence);
      expect(result.hedgingInstruction).toBeUndefined();
    });
  });
});
