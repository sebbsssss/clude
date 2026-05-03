import { Link } from 'react-router-dom';
import { useWikiData } from '../pages/Wiki/use-wiki-data';
import { SHOWCASE_ARTICLES } from '../pages/Wiki/showcase-articles';

// Compact preview of the Brain Wiki summary, designed to drop into the
// existing Dashboard bento grid. Uses inline styles + the dashboard's CSS
// variables (--bg, --bg-card, --border, --blue, --text-faint…) so it
// matches the flat 2px-radius aesthetic of the surrounding cells.
export function WikiSummaryCard() {
  const { topics, memories, contradictions } = useWikiData({ showcase: true });

  const sectionsByKind = (kind: string) =>
    SHOWCASE_ARTICLES.flatMap((a) => a.sections.filter((s) => s.kind === kind));

  const tiles = [
    { accent: '#f59e0b', glyph: '?', label: 'Open',     value: sectionsByKind('question').length },
    { accent: '#2244ff', glyph: '☐', label: 'To do',    value: sectionsByKind('action').length },
    { accent: '#ef4444', glyph: '⚠', label: 'Conflict', value: contradictions.length },
    { accent: '#10b981', glyph: '✓', label: 'Working',  value: sectionsByKind('highlight').length },
    { accent: '#8b5cf6', glyph: '★', label: 'Decided',  value: sectionsByKind('decision').length },
  ];

  return (
    <div style={{
      marginBottom: 20,
      padding: 18,
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 2,
    }}>
      {/* Eyebrow + title row */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 14,
      }}>
        <div>
          <div style={{
            fontFamily: 'var(--mono)',
            fontSize: 9,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--text-faint)',
            fontWeight: 700,
            marginBottom: 4,
          }}>
            FROM YOUR BRAIN WIKI
          </div>
          <div style={{
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--text)',
            marginBottom: 4,
          }}>
            Across everything
          </div>
          <div style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            fontFamily: 'var(--mono)',
            letterSpacing: '0.04em',
          }}>
            <strong style={{ color: 'var(--text)' }}>{topics.length}</strong> topics ·{' '}
            <strong style={{ color: 'var(--text)' }}>{memories.length}</strong> notes ·{' '}
            <strong style={{ color: 'var(--text)' }}>{sectionsByKind('action').length + sectionsByKind('question').length + contradictions.length}</strong> need attention
          </div>
        </div>
        <Link to="/wiki" style={{
          fontFamily: 'var(--mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--blue)',
          textDecoration: 'none',
          padding: '6px 10px',
          border: '1px solid var(--blue)',
          borderRadius: 2,
          flexShrink: 0,
        }}>
          Open →
        </Link>
      </div>

      {/* Tile row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 6,
      }}>
        {tiles.map((t) => (
          <Link key={t.label} to="/wiki" style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            padding: '8px 10px',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderLeft: `2px solid ${t.accent}`,
            borderRadius: 2,
            textDecoration: 'none',
            color: 'inherit',
          }}>
            <span style={{
              fontFamily: 'var(--mono)',
              fontSize: 10,
              fontWeight: 700,
              color: t.accent,
            }}>
              {t.glyph}
            </span>
            <span style={{
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--text)',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}>
              {t.value}
            </span>
            <span style={{
              fontFamily: 'var(--mono)',
              fontSize: 9,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-faint)',
            }}>
              {t.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
