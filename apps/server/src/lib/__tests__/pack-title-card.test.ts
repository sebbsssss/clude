import { describe, it, expect } from 'vitest';
import { esc, wrapName, formatCardDate, renderPackTitleCardSvg } from '../pack-title-card.js';

describe('esc — XML escaping', () => {
  it('escapes all five XML-significant characters', () => {
    expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
  it('leaves safe text untouched', () => {
    expect(esc('My Memory Pack 2026')).toBe('My Memory Pack 2026');
  });
});

describe('wrapName', () => {
  it('keeps a short name on one line', () => {
    expect(wrapName('Trip Notes')).toEqual(['Trip Notes']);
  });
  it('wraps a long name to at most two lines', () => {
    const lines = wrapName('Quarterly Engineering Retrospective Archive Bundle');
    expect(lines.length).toBeLessThanOrEqual(2);
  });
  it('ellipsises when content overflows two lines', () => {
    const lines = wrapName('alpha beta gamma delta epsilon zeta eta theta iota kappa');
    expect(lines.length).toBe(2);
    expect(lines[lines.length - 1].endsWith('…')).toBe(true);
  });
  it('hard-truncates a single oversized word', () => {
    const [line] = wrapName('Supercalifragilisticexpialidocious');
    expect(line.length).toBeLessThanOrEqual(20);
    expect(line.endsWith('…')).toBe(true);
  });
  it('falls back to a placeholder for empty input', () => {
    expect(wrapName('   ')).toEqual(['Untitled Pack']);
  });
});

describe('formatCardDate', () => {
  it('formats an ISO timestamp without locale dependence', () => {
    expect(formatCardDate('2026-06-20T12:34:56Z')).toBe('Jun 20, 2026');
  });
  it('returns empty string for null/garbage', () => {
    expect(formatCardDate(null)).toBe('');
    expect(formatCardDate('not-a-date')).toBe('');
  });
});

describe('renderPackTitleCardSvg', () => {
  const base = {
    name: 'My Memory Pack',
    memoryCount: 1234,
    dateISO: '2026-06-20T00:00:00Z',
    packId: 'pack-abcdef12',
    mintAddress: 'BhKwFd8fXyz1111111111111111111111111111111',
    chain: 'solana-devnet',
  };

  it('produces a well-formed 1000×1000 svg root', () => {
    const svg = renderPackTitleCardSvg(base);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="1000" height="1000"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('renders the pack name, formatted count, and date', () => {
    const svg = renderPackTitleCardSvg(base);
    expect(svg).toContain('My Memory Pack');
    expect(svg).toContain('1,234'); // en-US grouped
    expect(svg).toContain('Jun 20, 2026');
  });

  it('SECURITY: escapes a malicious pack name — no raw markup injection', () => {
    const svg = renderPackTitleCardSvg({ ...base, name: '</text><script>alert(1)</script>' });
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('</text><script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('omits the date + chain rows cleanly when absent', () => {
    const svg = renderPackTitleCardSvg({ ...base, dateISO: null, chain: null, mintAddress: null });
    expect(svg).not.toContain('CREATED');
    expect(svg).toContain('1 OF 1'); // edition badge always present
  });
});
