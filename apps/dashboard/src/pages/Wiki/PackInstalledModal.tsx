import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MemoryPack } from './wiki-packs';

// Post-install confirmation modal. Tells the user what they just got, what's
// now happening behind the scenes, and how to make use of it.
//
// Matches the dashboard's flat 2px-corner aesthetic: monospace eyebrows,
// italic-serif lede, dashed borders for grouping, the same glyph language
// the wiki page uses for section kinds (§ overview, ☐ action, ✓ working).

interface Props {
  pack: MemoryPack;
  onClose: () => void;
}

export function PackInstalledModal({ pack, onClose }: Props) {
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const accent = verticalToColor(pack.vertical);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    // Trap focus so screen readers announce the modal cleanly.
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sampleKeywords = pack.rules.flatMap((r) => r.keywords).slice(0, 4);
  const examplePhrase = sampleKeywords.length > 0
    ? `Mention things like "${sampleKeywords.slice(0, 2).join('", "')}", "${sampleKeywords[2] ?? sampleKeywords[0]}" in any chat.`
    : "Mention pack-relevant content in any chat.";

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-labelledby="pack-installed-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          background: 'var(--bg-card)',
          color: 'var(--text)',
          border: '1px solid var(--border-strong)',
          borderRadius: 2,
          boxShadow: '0 24px 60px rgba(0,0,0,0.32)',
          position: 'relative',
        }}
      >
        {/* Cluster-color top stripe — same identity bar as the wiki hero. */}
        <span style={{
          display: 'block',
          height: 3,
          background: accent,
        }} />

        <div style={{ padding: '22px 26px 4px' }}>
          {/* Eyebrow */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'var(--mono)',
            fontSize: 9,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: 'var(--text-faint)',
            marginBottom: 8,
          }}>
            <span style={{ color: accent }}>● {pack.vertical} pack</span>
            <span>·</span>
            <span>v{pack.version}</span>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                marginLeft: 'auto',
                background: 'transparent',
                border: 0,
                fontSize: 16,
                color: 'var(--text-faint)',
                cursor: 'pointer',
                padding: 0,
              }}
            >✕</button>
          </div>

          <h2 id="pack-installed-title" style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            margin: '0 0 8px',
            color: 'var(--text)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <span style={{ color: '#10b981', fontSize: 16 }}>✓</span>
            {pack.name} is now installed
          </h2>

          <p style={{
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            fontSize: 14,
            lineHeight: 1.55,
            color: 'var(--text-muted)',
            margin: '0 0 22px',
          }}>
            Your wiki just gained{' '}
            <strong style={{ color: 'var(--text)', fontStyle: 'normal' }}>
              {pack.topics.length} new topics
            </strong>
            , and your agent is now actively listening for{' '}
            {pack.vertical.toLowerCase()}-relevant patterns in every conversation.
          </p>
        </div>

        {/* — What's in this pack — */}
        <Section title="What's in this pack" glyph="§" accent="var(--text-faint)">
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 6,
          }}>
            {pack.topics.map((t) => (
              <div key={t.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 2,
                fontSize: 12,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: t.color,
                  flexShrink: 0,
                }} />
                <span style={{ color: 'var(--text)' }}>{t.name}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* — How to use it — */}
        <Section title="How to use it" glyph="☐" accent="var(--blue)">
          <ol style={{
            margin: 0,
            paddingLeft: 20,
            fontSize: 13,
            lineHeight: 1.7,
            color: 'var(--text)',
          }}>
            <li>
              {examplePhrase}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 4,
                marginTop: 6,
              }}>
                {sampleKeywords.map((kw) => (
                  <span key={kw} style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    padding: '2px 6px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 2,
                    color: 'var(--text-muted)',
                  }}>
                    {kw}
                  </span>
                ))}
              </div>
            </li>
            <li style={{ marginTop: 8 }}>
              Memories matching these patterns auto-tag into the right topic.
              Word-boundary matching plus embedding similarity catches semantic
              intent even when the exact keyword isn't there.
            </li>
            <li style={{ marginTop: 8 }}>
              View them organised in your Brain Wiki — each topic ships with
              section templates, so the structure is ready before any memories
              even land.
            </li>
          </ol>
        </Section>

        {/* — What's already happening — */}
        <Section title="What's already happening" glyph="✓" accent="#10b981">
          <ul style={{
            margin: 0,
            paddingLeft: 0,
            listStyle: 'none',
            fontSize: 12,
            lineHeight: 1.7,
            color: 'var(--text)',
          }}>
            <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
              <span style={{ color: '#10b981', fontFamily: 'var(--mono)' }}>→</span>
              <span>Topic rail in <code style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                padding: '0 4px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 2,
              }}>/wiki</code> extended with {pack.topics.length} new topics</span>
            </li>
            <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
              <span style={{ color: '#10b981', fontFamily: 'var(--mono)' }}>→</span>
              <span>{pack.rules.length} categorisation rules now applied to incoming memories</span>
            </li>
            <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
              <span style={{ color: '#10b981', fontFamily: 'var(--mono)' }}>→</span>
              <span>Embedding-similarity tagger running asynchronously — catches semantic intent the keyword layer misses</span>
            </li>
            <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: '#10b981', fontFamily: 'var(--mono)' }}>→</span>
              <span>Topics with section templates show their structure even before they have memories</span>
            </li>
          </ul>
        </Section>

        {/* CTAs */}
        <div style={{
          padding: '18px 26px 22px',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          borderTop: '1px solid var(--border)',
        }}>
          <button
            onClick={onClose}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontWeight: 700,
              padding: '9px 16px',
              background: 'transparent',
              color: 'var(--text-muted)',
              border: '1px solid var(--border-strong)',
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            Got it
          </button>
          <button
            onClick={() => { onClose(); navigate('/wiki'); }}
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontWeight: 700,
              padding: '9px 16px',
              background: 'var(--blue)',
              color: '#fff',
              border: '1px solid var(--blue)',
              borderRadius: 2,
              cursor: 'pointer',
            }}
          >
            Open Brain Wiki →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────── Section (matches the wiki's section-kind visual language) ───────────

function Section({ title, glyph, accent, children }: {
  title: string;
  glyph: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      padding: '14px 26px',
      borderTop: '1px solid var(--border)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        marginBottom: 10,
      }}>
        <span style={{
          fontFamily: 'var(--mono)',
          fontSize: 14,
          fontWeight: 700,
          color: accent,
          width: 14,
          textAlign: 'center',
          flexShrink: 0,
        }}>{glyph}</span>
        <span style={{
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--text)',
          letterSpacing: '-0.005em',
        }}>{title}</span>
      </div>
      <div style={{ paddingLeft: 24 }}>
        {children}
      </div>
    </div>
  );
}

function verticalToColor(vertical: string): string {
  switch (vertical.toLowerCase()) {
    case 'compliance': return '#0EA5E9';
    case 'sales':      return '#10B981';
    case 'general':    return '#2244FF';
    default:           return '#8B5CF6';
  }
}
