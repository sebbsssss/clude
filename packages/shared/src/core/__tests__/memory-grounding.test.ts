import { describe, it, expect } from 'vitest';
import { renderGroundedLine, byMemoryDateAsc, GROUNDED_CONTENT_MAX } from '../memory-grounding';

describe('renderGroundedLine', () => {
  it('dates the line and includes a content snippet beyond the summary', () => {
    const line = renderGroundedLine({
      created_at: '2026-05-15T10:00:00Z',
      summary: 'Prefers TS',
      content: 'The user strongly prefers TypeScript.',
    });
    expect(line).toMatch(/^- \[2026-05-15\] /);
    expect(line).toContain('Prefers TS');
    expect(line).toContain('strongly prefers TypeScript');
  });

  it('clamps long content and marks the truncation', () => {
    const line = renderGroundedLine({ created_at: '2026-05-15T10:00:00Z', summary: 's', content: 'x'.repeat(2000) });
    expect(line).toContain('…');
    expect(line).not.toContain('x'.repeat(GROUNDED_CONTENT_MAX + 50));
  });

  it('falls back to summary when content duplicates it', () => {
    expect(renderGroundedLine({ created_at: '2026-05-15T10:00:00Z', summary: 'Same', content: 'Same' }))
      .toBe('- [2026-05-15] Same');
  });

  it('tolerates missing date and content', () => {
    expect(renderGroundedLine({ summary: 'just a summary' })).toBe('- just a summary');
  });

  it('appends an optional suffix (e.g. procedural success rate)', () => {
    expect(renderGroundedLine({ summary: 'Reply tersely' }, ' [80% success]')).toBe('- Reply tersely [80% success]');
  });
});

describe('byMemoryDateAsc', () => {
  it('orders oldest→newest', () => {
    const arr = [
      { created_at: '2026-05-01T00:00:00Z', summary: 'b' },
      { created_at: '2026-01-01T00:00:00Z', summary: 'a' },
    ];
    expect([...arr].sort(byMemoryDateAsc).map(m => m.summary)).toEqual(['a', 'b']);
  });

  it('sinks undated entries to the end (stable order preserved)', () => {
    const arr = [
      { summary: 'u1' },
      { created_at: '2026-03-01T00:00:00Z', summary: 'd' },
      { summary: 'u2' },
    ];
    expect([...arr].sort(byMemoryDateAsc).map(m => m.summary)).toEqual(['d', 'u1', 'u2']);
  });
});
