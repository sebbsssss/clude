import { describe, it, expect, vi } from 'vitest';

// memory.ts pulls in database.ts → config.ts, which validates required env at load
// (throws "Missing X_API_KEY" with no .env). Run config in lightweight/site-only mode
// so the import is side-effect-free. vi.hoisted executes before the static import below.
vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
});

import { formatMemoryContext, type Memory } from '../memory';

/** Minimal valid Memory; override only the fields a test cares about. */
const mem = (over: Partial<Memory> = {}): Memory => ({
  id: 1,
  hash_id: 'clude-test',
  memory_type: 'semantic',
  content: 'The user said they strongly prefer TypeScript over JavaScript for all new projects.',
  summary: 'User prefers TypeScript',
  tags: [],
  concepts: [],
  emotional_valence: 0,
  importance: 0.5,
  access_count: 0,
  source: 'test',
  source_id: null,
  related_user: null,
  related_wallet: null,
  metadata: {},
  created_at: '2026-05-15T10:00:00Z',
  last_accessed: '2026-05-15T10:00:00Z',
  decay_factor: 1,
  evidence_ids: [],
  solana_signature: null,
  compacted: false,
  compacted_into: null,
  encrypted: false,
  encryption_pubkey: null,
  ...over,
}) as Memory;

describe('formatMemoryContext — grounded, dated, timeline-ordered (bot + SDK formatter)', () => {
  it('returns empty string for no memories', () => {
    expect(formatMemoryContext([])).toBe('');
  });

  it('dates every line, including semantic (previously undated)', () => {
    const out = formatMemoryContext([mem()]);
    expect(out).toMatch(/- \[2026-05-15\] /);
  });

  it('includes a content snippet beyond the summary so the model has groundable facts', () => {
    const out = formatMemoryContext([mem()]);
    expect(out).toContain('User prefers TypeScript');
    expect(out).toContain('strongly prefer TypeScript over JavaScript');
  });

  it('clamps long content and marks the truncation', () => {
    const out = formatMemoryContext([mem({ content: 'x'.repeat(2000) })]);
    expect(out).toContain('…');
    expect(out).not.toContain('x'.repeat(700)); // only ~600 chars survive
  });

  it('orders a section oldest→newest so conflicts read as a timeline', () => {
    const older = mem({ summary: 'Lives in Berlin', content: 'I live in Berlin', created_at: '2026-01-10T00:00:00Z' });
    const newer = mem({ summary: 'Lives in Lisbon', content: 'I moved to Lisbon', created_at: '2026-05-01T00:00:00Z' });
    const out = formatMemoryContext([newer, older]); // passed newest-first
    expect(out.indexOf('Berlin')).toBeLessThan(out.indexOf('Lisbon'));
  });

  it('carries temporal-scoped grounding rules (no-invention + as-of + general-knowledge)', () => {
    const out = formatMemoryContext([mem()]);
    expect(out).toMatch(/say you don't remember it/i);
    expect(out).toMatch(/timeline/i);
    expect(out).toMatch(/as of/i);
    expect(out).toMatch(/never blend/i);
    expect(out).toMatch(/don't invent|do not invent/i);
    expect(out).toMatch(/general knowledge is unaffected/i);
    // No longer the old confabulation-inviting copy.
    expect(out).not.toContain('Reference them naturally if relevant');
  });

  it('preserves the procedural success-rate annotation and MUST-follow directive', () => {
    const proc = mem({
      memory_type: 'procedural',
      summary: 'Reply tersely',
      metadata: { positiveRate: 0.8, basedOn: 12 } as Record<string, unknown>,
    });
    const out = formatMemoryContext([proc]);
    expect(out).toContain('80% success rate, based on 12 interactions');
    expect(out).toMatch(/You MUST follow the Learned Strategies/i);
  });

  it('keeps the tier section headers', () => {
    const out = formatMemoryContext([
      mem(),
      mem({ memory_type: 'procedural', summary: 'Reply tersely' }),
      mem({ memory_type: 'self_model', summary: 'I over-explain' }),
      mem({ memory_type: 'episodic', summary: 'Met at the conference' }),
      mem({ memory_type: 'introspective', summary: 'Felt uncertain' }),
    ]);
    for (const h of [
      '## Memory Recall',
      '### Past Interactions',
      '### Things You Know',
      '### Learned Strategies (from past outcomes)',
      '### Your Own Reflections',
      '### Self-Observations',
    ]) {
      expect(out).toContain(h);
    }
  });

  it('does not mutate the caller-supplied array', () => {
    const a = mem({ summary: 'first', created_at: '2026-05-01T00:00:00Z' });
    const b = mem({ summary: 'second', created_at: '2026-01-01T00:00:00Z' });
    const input = [a, b];
    formatMemoryContext(input);
    expect(input[0]).toBe(a);
    expect(input[1]).toBe(b);
  });
});
