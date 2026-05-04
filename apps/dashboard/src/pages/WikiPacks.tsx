import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { ALL_PACKS, getPack, type MemoryPack } from './Wiki/wiki-packs';
import { PackInstalledModal } from './Wiki/PackInstalledModal';

// Wiki-pack discovery page.
//
// Different from /packs (which is memory-bundle export/import).
// This page browses topic-taxonomy packs that scaffold the /wiki page —
// install Compliance and your audit-related memories auto-route into
// Audit Logs / Evidence / Regulator Asks topics with section structure
// already in place.

type LoadState = 'loading' | 'ready' | 'error';

export function WikiPacks() {
  const navigate = useNavigate();
  const [installed, setInstalled] = useState<string[]>(['workspace']);
  const [state, setState] = useState<LoadState>('loading');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tracks the pack id of the most recent successful install so we can pop
  // the post-install modal. Cleared when the modal is dismissed.
  const [justInstalled, setJustInstalled] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listInstalledWikiPacks()
      .then((ids) => { if (!cancelled) { setInstalled(ids); setState('ready'); } })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load packs');
          setState('error');
        }
      });
    return () => { cancelled = true; };
  }, []);

  const togglePack = async (id: string) => {
    const willInstall = !installed.includes(id);
    setPendingId(id);
    setError(null);
    // Optimistic.
    setInstalled((cur) => willInstall ? [...cur, id] : cur.filter((c) => c !== id));
    try {
      if (willInstall) {
        await api.installWikiPack(id);
        // Pop the post-install modal — only on actual install (not uninstall).
        // Skip for the default workspace pack since users can't actively
        // install it (the button is disabled).
        if (id !== 'workspace') setJustInstalled(id);
      } else {
        await api.uninstallWikiPack(id);
      }
    } catch (err) {
      // Revert on failure.
      setInstalled((cur) => willInstall ? cur.filter((c) => c !== id) : [...cur, id]);
      setError(err instanceof Error ? err.message : 'Failed to update pack');
    } finally {
      setPendingId(null);
    }
  };

  const installedSet = new Set(installed);
  const installedCount = ALL_PACKS.filter((p) => installedSet.has(p.id)).length;
  const totalTopics = ALL_PACKS
    .filter((p) => installedSet.has(p.id))
    .reduce((sum, p) => sum + p.topics.length, 0);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '8px 0 60px' }}>
      <Hero installed={installedCount} totalTopics={totalTopics} onOpenWiki={() => navigate('/wiki')} />

      {/* Surface ANY error — initial-load OR install/uninstall toggle. The
          previous render only showed errors when state === 'error', which was
          only set on initial-load failure. Toggle failures stored the error
          but never displayed it, so installs that hit a missing-table 500
          looked silent. */}
      {(state === 'error' || error) && (
        <div style={{
          margin: '0 0 20px',
          padding: '10px 14px',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          background: 'rgba(239, 68, 68, 0.06)',
          color: '#ef4444',
          borderRadius: 2,
          fontFamily: 'var(--mono)',
          fontSize: 11,
        }}>
          {state === 'error'
            ? `Couldn't reach the server: ${error}. Showing pack list anyway — installs will retry on click.`
            : `Install failed: ${error}`}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
        gap: 18,
      }}>
        {ALL_PACKS.map((pack) => (
          <PackCard
            key={pack.id}
            pack={pack}
            installed={installedSet.has(pack.id)}
            pending={pendingId === pack.id}
            onToggle={() => togglePack(pack.id)}
          />
        ))}
        <ComingSoonCard />
      </div>

      <Footer />

      {/* Post-install confirmation modal. Surfaces what the pack just did
          + how to use it, anchored to the dashboard's flat aesthetic. */}
      {justInstalled && (() => {
        const pack = getPack(justInstalled);
        if (!pack) return null;
        return (
          <PackInstalledModal
            pack={pack}
            onClose={() => setJustInstalled(null)}
          />
        );
      })()}
    </div>
  );
}

// ─────────── Hero ───────────

function Hero({ installed, totalTopics, onOpenWiki }: {
  installed: number; totalTopics: number; onOpenWiki: () => void;
}) {
  return (
    <header style={{
      position: 'relative',
      padding: '4px 0 28px 24px',
      marginBottom: 32,
      borderBottom: '1px solid var(--border)',
    }}>
      <span style={{
        position: 'absolute',
        left: 0, top: 8, bottom: 28,
        width: 4,
        borderRadius: 2,
        background: 'var(--blue)',
      }} aria-hidden />
      <div style={{
        fontFamily: 'var(--mono)',
        fontSize: 10,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'var(--text-faint)',
        fontWeight: 700,
        marginBottom: 6,
      }}>
        WIKI PACKS
      </div>
      <h1 style={{
        fontSize: 30,
        fontWeight: 700,
        letterSpacing: '-0.015em',
        margin: '0 0 10px',
        color: 'var(--text)',
      }}>
        Install verticals to scaffold your wiki
      </h1>
      <p style={{
        fontFamily: 'Georgia, serif',
        fontStyle: 'italic',
        fontSize: 16,
        lineHeight: 1.55,
        color: 'var(--text-muted)',
        margin: 0,
        maxWidth: 640,
      }}>
        A pack defines topics, section templates, and rules that auto-categorise
        your memories. Install one and your agent starts routing relevant
        conversations into the right place automatically.
      </p>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        marginTop: 18,
      }}>
        <Stat label="Installed" value={installed} />
        <Stat label="Topics scaffolded" value={totalTopics} />
        <button
          onClick={onOpenWiki}
          style={{
            marginLeft: 'auto',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: 'var(--blue)',
            background: 'transparent',
            border: '1px solid var(--blue)',
            padding: '8px 14px',
            cursor: 'pointer',
            borderRadius: 2,
          }}
        >
          Open Brain Wiki →
        </button>
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      fontFamily: 'var(--mono)',
      fontSize: 11,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color: 'var(--text-faint)',
    }}>
      <strong style={{ color: 'var(--text)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </strong>{' '}
      {label}
    </div>
  );
}

// ─────────── Pack card ───────────

function PackCard({ pack, installed, pending, onToggle }: {
  pack: MemoryPack;
  installed: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const allKeywords = pack.rules.flatMap((r) => r.keywords);
  const verticalAccent = verticalToColor(pack.vertical);

  return (
    <div style={{
      position: 'relative',
      border: '1px solid var(--border)',
      borderRadius: 2,
      background: 'var(--bg-card)',
      padding: '16px 18px 14px 22px',
      overflow: 'hidden',
      transition: 'border-color 0.12s ease',
      ...(installed ? { borderColor: 'rgba(16, 185, 129, 0.35)' } : null),
    }}>
      <span style={{
        position: 'absolute',
        left: 0, top: 0, bottom: 0,
        width: 3,
        background: verticalAccent,
      }} aria-hidden />

      {/* Eyebrow */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'var(--mono)',
        fontSize: 9,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: 'var(--text-faint)',
        marginBottom: 6,
      }}>
        <span style={{ color: verticalAccent }}>{pack.vertical}</span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span>{pack.vendor}</span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span>v{pack.version}</span>
        {installed && (
          <span style={{
            marginLeft: 'auto',
            color: '#10b981',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#10b981',
            }} />
            INSTALLED
          </span>
        )}
      </div>

      {/* Title + action */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 14,
        marginBottom: 8,
      }}>
        <h2 style={{
          fontFamily: 'system-ui, sans-serif',
          fontSize: 18,
          fontWeight: 700,
          margin: 0,
          color: 'var(--text)',
          letterSpacing: '-0.005em',
        }}>
          {pack.name}
        </h2>
        <button
          onClick={onToggle}
          disabled={pack.installedByDefault || pending}
          title={pack.installedByDefault ? 'Default pack — always installed' : undefined}
          style={{
            flexShrink: 0,
            fontFamily: 'system-ui, sans-serif',
            fontSize: 11,
            fontWeight: 700,
            padding: '6px 12px',
            border: pack.installedByDefault
              ? '1px solid var(--border)'
              : (installed ? '1px solid var(--border-strong)' : '1px solid var(--blue)'),
            background: pack.installedByDefault
              ? 'transparent'
              : (installed ? 'transparent' : 'var(--blue)'),
            color: pack.installedByDefault
              ? 'var(--text-faint)'
              : (installed ? 'var(--text-muted)' : '#fff'),
            borderRadius: 2,
            cursor: pack.installedByDefault || pending ? 'not-allowed' : 'pointer',
            opacity: pending ? 0.6 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {pack.installedByDefault
            ? '✓ Default'
            : installed
              ? (pending ? 'Removing…' : 'Uninstall')
              : (pending ? 'Installing…' : '+ Install')}
        </button>
      </div>

      {/* Description */}
      <p style={{
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        lineHeight: 1.55,
        color: 'var(--text-muted)',
        margin: '0 0 14px',
      }}>
        {pack.description}
      </p>

      {/* Topic chips */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 5,
        marginBottom: 10,
      }}>
        {pack.topics.map((t) => (
          <span key={t.id} style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '3px 8px',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 11,
            color: 'var(--text)',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 2,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: t.color,
            }} />
            {t.name}
          </span>
        ))}
      </div>

      {/* Expand: show rules + section templates */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          background: 'transparent',
          border: 0,
          padding: 0,
          fontFamily: 'var(--mono)',
          fontSize: 10,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
          cursor: 'pointer',
        }}
      >
        {expanded ? '▾ Hide details' : '▸ What this pack does'}
      </button>

      {expanded && (
        <div style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
        }}>
          <DetailRow
            label="Auto-tags on"
            value={allKeywords.slice(0, 12).join(' · ') + (allKeywords.length > 12 ? '…' : '')}
          />
          <DetailRow
            label="Total topics"
            value={`${pack.topics.length} (${pack.topics.filter((t) => t.sectionTemplates).length} with section templates)`}
          />
          <DetailRow
            label="Categorisation rules"
            value={`${pack.rules.length} rules · ${allKeywords.length} keywords total`}
          />
          {pack.topics.some((t) => t.sectionTemplates) && (
            <div style={{ marginTop: 12 }}>
              <div style={{
                fontFamily: 'var(--mono)',
                fontSize: 9,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: 'var(--text-faint)',
                marginBottom: 6,
              }}>
                Section structure (sample)
              </div>
              {pack.topics.filter((t) => t.sectionTemplates).slice(0, 2).map((t) => (
                <div key={t.id} style={{ marginBottom: 8 }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text)',
                    marginBottom: 3,
                  }}>
                    {t.name}
                  </div>
                  <div style={{
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontFamily: 'system-ui, sans-serif',
                    paddingLeft: 10,
                  }}>
                    {t.sectionTemplates!.map((s) => s.title).join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '120px 1fr',
      gap: 12,
      marginBottom: 6,
      alignItems: 'baseline',
    }}>
      <span style={{
        fontFamily: 'var(--mono)',
        fontSize: 9,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: 'var(--text-faint)',
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        color: 'var(--text)',
      }}>
        {value}
      </span>
    </div>
  );
}

// ─────────── "More coming" placeholder ───────────

function ComingSoonCard() {
  return (
    <div style={{
      border: '1px dashed var(--border-strong)',
      borderRadius: 2,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      minHeight: 220,
      color: 'var(--text-faint)',
    }}>
      <div style={{
        fontFamily: 'var(--mono)',
        fontSize: 11,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        fontWeight: 700,
        marginBottom: 8,
      }}>
        More coming
      </div>
      <p style={{
        fontFamily: 'Georgia, serif',
        fontStyle: 'italic',
        fontSize: 13,
        lineHeight: 1.55,
        color: 'var(--text-muted)',
        margin: '0 0 12px',
        maxWidth: 280,
      }}>
        Engineering, Customer Success, Legal, Research, HR — third-party packs
        and a publishing flow are next.
      </p>
      <a
        href="https://github.com/sebbsssss/clude/issues/new?labels=pack-request&title=Pack+request:"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--blue)',
          fontWeight: 700,
          textDecoration: 'none',
        }}
      >
        Request a pack →
      </a>
    </div>
  );
}

// ─────────── Footer ───────────

function Footer() {
  return (
    <div style={{
      marginTop: 32,
      paddingTop: 18,
      borderTop: '1px solid var(--border)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 16,
      flexWrap: 'wrap',
    }}>
      <div style={{
        fontFamily: 'Georgia, serif',
        fontStyle: 'italic',
        fontSize: 13,
        color: 'var(--text-muted)',
        maxWidth: 540,
      }}>
        Building a pack? The format is open — manifests live in
        <code style={{
          fontFamily: 'var(--mono)',
          fontSize: 12,
          padding: '1px 5px',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 2,
          margin: '0 4px',
        }}>packages/shared/src/wiki-packs.ts</code>
        and define topics, section templates, and keyword rules.
      </div>
      <a
        href="https://github.com/sebbsssss/clude/blob/main/packages/shared/src/wiki-packs.ts"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--blue)',
          fontWeight: 700,
          textDecoration: 'none',
        }}
      >
        Pack format docs →
      </a>
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
