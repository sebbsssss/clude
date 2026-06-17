import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, renderMemoryLine } from '../memory-prompt';

const mem = (over: Record<string, unknown> = {}) => ({
  memory_type: 'semantic',
  summary: 'User prefers TypeScript',
  content: 'The user said they strongly prefer TypeScript over JavaScript for all new projects.',
  created_at: '2026-05-15T10:00:00Z',
  ...over,
});

describe('renderMemoryLine', () => {
  it('dates every line (not just episodic)', () => {
    expect(renderMemoryLine(mem())).toMatch(/^- \[2026-05-15\] /);
  });

  it('includes a content snippet so the model has groundable facts beyond the summary', () => {
    const line = renderMemoryLine(mem());
    expect(line).toContain('User prefers TypeScript');
    expect(line).toContain('strongly prefer TypeScript over JavaScript');
  });

  it('clamps long content and marks the truncation', () => {
    const line = renderMemoryLine(mem({ content: 'x'.repeat(2000) }));
    expect(line.length).toBeLessThan(750); // 600 content + summary + stamp + overhead
    expect(line).toContain('…');
  });

  it('falls back to summary only when content duplicates it', () => {
    const line = renderMemoryLine(mem({ content: 'User prefers TypeScript' }));
    expect(line).toBe('- [2026-05-15] User prefers TypeScript');
  });

  it('tolerates missing date and missing content', () => {
    expect(renderMemoryLine({ summary: 'just a summary' })).toBe('- just a summary');
  });
});

describe('buildSystemPrompt — grounding rules (hallucination defense)', () => {
  it('includes the grounding rules when memories exist', () => {
    const prompt = buildSystemPrompt([mem()], { totalMemoryCount: 10 });
    expect(prompt).toContain('<memory_rules>');
    expect(prompt).toMatch(/say you don't remember it rather than guessing/i);
  });

  it('states temporal-scoped conflict resolution — timeline, latest-for-now, as-of-for-past', () => {
    const prompt = buildSystemPrompt([mem()], { totalMemoryCount: 10 });
    // Conflicting dated memories are a timeline, not a contradiction.
    expect(prompt).toMatch(/timeline/i);
    // A present-tense question resolves to the newest value…
    expect(prompt).toMatch(/most recent/i);
    // …but an as-of-a-past-date question resolves to the value in effect then.
    // This is the fix for the wrong-date hallucination class (HaluMem Dynamic-Update 17%).
    expect(prompt).toMatch(/as of|in effect (?:at|then)/i);
    expect(prompt).toMatch(/never blend|don't blend/i);
  });

  it('scopes grounding to user claims — general knowledge stays answerable', () => {
    const prompt = buildSystemPrompt([mem()], { totalMemoryCount: 10 });
    expect(prompt).toMatch(/General knowledge is unaffected/i);
  });

  it('omits memory_rules when there are no memories (nothing to ground in)', () => {
    const prompt = buildSystemPrompt([], { totalMemoryCount: 10 });
    expect(prompt).not.toContain('<memory_rules>');
  });
});

describe('buildSystemPrompt — empty-recall honesty', () => {
  it('no longer invites confabulation when memories exist but none matched', () => {
    const prompt = buildSystemPrompt([], { totalMemoryCount: 42 });
    // The old copy — "You still know them — offer to help with anything they need" —
    // told the model to perform familiarity it had no grounding for.
    expect(prompt).not.toContain('You still know them');
    expect(prompt).toMatch(/Do not invent or guess past conversations/i);
    expect(prompt).toMatch(/say you don't remember it/i);
  });

  it('new-user state stays welcoming but adds the no-pretending rule', () => {
    const prompt = buildSystemPrompt([], { totalMemoryCount: 0 });
    expect(prompt).toContain('new user with no stored memories');
    expect(prompt).toMatch(/Do not pretend to already know things/i);
  });
});

describe('buildSystemPrompt — structure preserved', () => {
  it('keeps the type-tier sections', () => {
    const memories = [
      mem(),
      mem({ memory_type: 'procedural', summary: 'Always reply tersely' }),
      mem({ memory_type: 'self_model', summary: 'I tend to over-explain' }),
      mem({ memory_type: 'episodic', summary: 'Met at the conference' }),
    ];
    const prompt = buildSystemPrompt(memories, { totalMemoryCount: 4 });
    for (const tag of ['<knowledge>', '<behaviors>', '<identity>', '<recent>', '<memories count="4">']) {
      expect(prompt).toContain(tag);
    }
  });

  it('greeting variant carries the grounding rules too', () => {
    const prompt = buildSystemPrompt([mem()], { totalMemoryCount: 1, isGreeting: true });
    expect(prompt).toContain('just signed in');
    expect(prompt).toContain('<memory_rules>');
  });
});

describe('buildSystemPrompt — chronological timeline ordering', () => {
  it('orders memories within a section oldest→newest so conflicts read as a timeline', () => {
    const older = mem({ summary: 'Lives in Berlin', content: 'I live in Berlin', created_at: '2026-01-10T00:00:00Z' });
    const newer = mem({ summary: 'Lives in Lisbon', content: 'I moved to Lisbon', created_at: '2026-05-01T00:00:00Z' });
    // Passed newest-first (relevance order); output must be oldest-first so the
    // model sees Berlin → Lisbon as a progression and can apply the as-of rule.
    const prompt = buildSystemPrompt([newer, older], { totalMemoryCount: 2 });
    expect(prompt.indexOf('Berlin')).toBeLessThan(prompt.indexOf('Lisbon'));
  });

  it('keeps undated memories from breaking the sort (they sink to the end of the section)', () => {
    const dated = mem({ summary: 'fact AAA', created_at: '2026-03-01T00:00:00Z' });
    const undated = mem({ summary: 'fact ZZZ', created_at: undefined });
    const prompt = buildSystemPrompt([undated, dated], { totalMemoryCount: 2 });
    expect(prompt.indexOf('AAA')).toBeLessThan(prompt.indexOf('ZZZ'));
  });

  it('does not mutate the caller-supplied array', () => {
    const a = mem({ summary: 'first', created_at: '2026-05-01T00:00:00Z' });
    const b = mem({ summary: 'second', created_at: '2026-01-01T00:00:00Z' });
    const input = [a, b];
    buildSystemPrompt(input, { totalMemoryCount: 2 });
    expect(input[0]).toBe(a); // original order preserved in the caller's array
    expect(input[1]).toBe(b);
  });
});
