/**
 * Wiki — the agent's memory curated into readable knowledge.
 *
 * Three sub-tabs via a segmented control:
 *  · Briefing — a centered assistant digest: what needs attention (contradictions,
 *    open questions, fading memories), follow-ups (toggleable), worth-remembering
 *    (high-importance semantic / self-model memories), and a dream-cycle recap.
 *  · Inbox    — fragments waiting to be curated, conflicts flagged amber.
 *  · Packs    — installable topic taxonomies.
 *
 * Bound to the existing wiki data hook (topics / fragments / contradictions /
 * memories) plus the owner-scoped cortex stats. Where the design shows specifics
 * with no backing endpoint, sections derive from real data and degrade to a clean
 * empty state rather than rendering invented content.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { api } from '../lib/api';
import type { Memory, MemoryStats } from '../types/memory';
import { typeStyle, relTime, pct } from '../lib/memory-ui';
import { useWikiData } from './Wiki/use-wiki-data';
import type { Fragment, Topic } from './Wiki/wiki-data';

type SubTab = 'briefing' | 'inbox' | 'packs';

// Attention-dot colors used in the rail + section headers, matched to the design.
const C_ATTN = '#f59e0b';
const C_TASK = 'var(--accent)';
const C_KEEP = '#10b981';
const C_DREAM = '#8b5cf6';

interface PackDef {
  id: string;
  name: string;
  topics: number;
  blurb: string;
  defaultInstalled: boolean;
}

// Static catalog — `listMemoryPacks` returns empty in cortex mode, so the panel
// renders this taxonomy with local install/uninstall state (no-op against the
// backend in cortex; the UI still reflects intent and a clean installed count).
const PACK_CATALOG: PackDef[] = [
  { id: 'sales', name: 'Sales & Pricing', topics: 6, blurb: 'deal notes, objections, pricing.', defaultInstalled: true },
  { id: 'research', name: 'Research', topics: 8, blurb: 'benchmarks, papers, competitors.', defaultInstalled: true },
  { id: 'engineering', name: 'Engineering', topics: 10, blurb: 'architecture, incidents, decisions.', defaultInstalled: false },
  { id: 'personal', name: 'Personal', topics: 5, blurb: 'preferences, people, routines.', defaultInstalled: false },
];

interface FollowUp {
  id: string;
  text: string;
  meta: string;
  done: boolean;
}

interface AttentionCard {
  key: string;
  glyph: string;
  glyphColor: string;
  glyphBg: string;
  title: string;
  body: string;
  meta: string;
  action: string;
  /** primary = filled accent button; ghost = outlined */
  variant: 'primary' | 'ghost';
}

export function WikiScreen() {
  const [sub, setSub] = useState<SubTab>('briefing');

  // Live wiki data — topics, fragments, contradictions, and the memory pool. In
  // cortex mode the knowledge-graph calls return empty, so the hook degrades to
  // its demo dataset; `source` tells us which we got.
  const wiki = useWikiData({ showcase: false });
  const { topics, fragments, contradictions, memories, loading: wikiLoading, source } = wiki;

  // Self-model + stats from the owner-scoped cortex endpoints, for the
  // worth-remembering list, dream-cycle recap, and briefing counts.
  const [selfModel, setSelfModel] = useState<Memory[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [brain, s] = await Promise.all([
        api.getBrain().catch(() => null),
        api.getStats().catch(() => null),
      ]);
      if (!live) return;
      setSelfModel(brain?.consciousness.selfModel ?? []);
      setStats(s);
    })();
    return () => { live = false; };
  }, []);

  // ── Derive briefing sections from real data ──

  // Worth remembering: highest-importance semantic / self-model memories. Falls
  // back to top-importance of any type if those two tiers are thin.
  const worthRemembering = useMemo(() => {
    const pool = [...memories, ...selfModel];
    const seen = new Set<number>();
    const uniq = pool.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
    const preferred = uniq.filter(
      (m) => m.memory_type === 'semantic' || m.memory_type === 'self_model',
    );
    const ranked = (preferred.length >= 3 ? preferred : uniq)
      .slice()
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
    return ranked.slice(0, 4);
  }, [memories, selfModel]);

  // A useful memory that is fading: high importance but low retention. Surfaces
  // the single worst offender as the "reinforce" attention card.
  const fading = useMemo(() => {
    const candidates = [...memories, ...selfModel].filter(
      (m) => (m.importance ?? 0) >= 0.55 && (m.decay_factor ?? 1) < 0.7,
    );
    candidates.sort((a, b) => (a.decay_factor ?? 1) - (b.decay_factor ?? 1));
    return candidates[0] ?? null;
  }, [memories, selfModel]);

  // Needs-your-attention cards, assembled from whatever the data supports.
  const attentionCards = useMemo<AttentionCard[]>(() => {
    const cards: AttentionCard[] = [];

    const conflict = contradictions[0];
    if (conflict) {
      cards.push({
        key: 'conflict',
        glyph: '⚠',
        glyphColor: C_ATTN,
        glyphBg: 'rgba(245,158,11,0.14)',
        title: 'Two memories are in conflict',
        body: trimText(conflict.a.summary || conflict.a.content) + ' vs ' +
          trimText(conflict.b.summary || conflict.b.content),
        meta: `flagged ${relTime(conflict.b.createdAt)} ago · ${conflict.a.type} · contradiction`,
        action: 'Resolve',
        variant: 'primary',
      });
    }

    if (fading) {
      cards.push({
        key: 'fading',
        glyph: '◇',
        glyphColor: '#ec4899',
        glyphBg: 'rgba(236,72,153,0.14)',
        title: 'A useful memory is fading',
        body: `"${trimText(fading.summary || fading.content, 120)}" is down to ${pct(
          fading.decay_factor,
        )} retention. Reinforce it if it still holds.`,
        meta: `${labelType(fading.memory_type)} · last recalled ${relTime(fading.last_accessed)} ago`,
        action: 'Reinforce',
        variant: 'ghost',
      });
    }

    return cards;
  }, [contradictions, fading]);

  // Follow-ups: derive from procedural / recent episodic memories where present,
  // else degrade to an empty checklist (no invented tasks against live data).
  // Completion is purely local UI state — we hold the set of checked ids and
  // reconcile against the derived list so memory refreshes don't reset toggles.
  const [doneIds, setDoneIds] = useState<Set<string>>(() => new Set());
  const followUps = useMemo<FollowUp[]>(
    () =>
      memories
        .filter((m) => m.memory_type === 'procedural' || m.memory_type === 'episodic')
        .slice(0, 3)
        .map((m) => ({
          id: String(m.id),
          text: trimText(m.summary || m.content, 110),
          meta: `${labelType(m.memory_type)} · ${relTime(m.created_at)} ago`,
          done: doneIds.has(String(m.id)),
        })),
    [memories, doneIds],
  );

  const toggleFollowUp = (id: string) =>
    setDoneIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const tasksLeft = followUps.filter((t) => !t.done).length;

  // Dream-cycle recap. We have dream-session counts from stats but no per-run
  // detail in cortex mode, so the card states the count + newest activity and
  // degrades its merge/fade figures to em-dashes rather than fabricating them.
  const dreamSessions = stats?.totalDreamSessions ?? null;

  // Inbox: fragments still needing a decision — pending or conflict.
  const inboxFragments = useMemo(
    () => fragments.filter((f) => f.status === 'pending' || f.status === 'conflict'),
    [fragments],
  );
  const inboxBadge = inboxFragments.length;

  // Packs: local install state seeded from the catalog defaults.
  const [installed, setInstalled] = useState<Set<string>>(
    () => new Set(PACK_CATALOG.filter((p) => p.defaultInstalled).map((p) => p.id)),
  );
  const togglePack = (id: string) =>
    setInstalled((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Counts shown in the rail's "In this briefing" list.
  const needsYouCount = attentionCards.length;
  const railTopics = topics.slice(0, 7);

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      {/* ── Briefing rail ── */}
      <aside style={{ width: 248, flex: 'none', borderRight: '1px solid var(--border)', padding: '26px 16px', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto' }}>
        {/* Agent identity */}
        <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(135deg,#4466ff,#8b5cf6)', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src="/dashboard/Clude-Icon-Offwhite.svg" style={{ width: 17, height: 17, display: 'block' }} alt="" />
          </span>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>Atlas</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-3)', lineHeight: 1.45, marginTop: 2 }}>I sat with you this week and kept notes.</div>
          </div>
        </div>

        {/* In this briefing */}
        <div>
          <RailLabel>In this briefing</RailLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <RailRow color={C_ATTN} label="Needs you" count={needsYouCount} active strong />
            <RailRow color={C_TASK} label="Follow-ups" count={tasksLeft} />
            <RailRow color={C_KEEP} label="Worth remembering" count={worthRemembering.length || undefined} />
            <RailRow color={C_DREAM} label="While you were away" />
          </div>
        </div>

        {/* Browse topics */}
        <div style={{ marginTop: 'auto' }}>
          <RailLabel>Browse topics</RailLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 6px' }}>
            {railTopics.length === 0 && (
              <span style={{ fontSize: 11.5, color: 'var(--fg-3)', padding: '0 4px' }}>No topics yet.</span>
            )}
            {railTopics.map((t) => (
              <button
                key={t.id}
                className="topic"
                onClick={() => setSub('inbox')}
                style={{ fontSize: 11.5, color: 'var(--fg-2)', background: 'var(--surface-2)', padding: '4px 10px', borderRadius: 99, cursor: 'pointer', border: 'none' }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        {/* Sticky header + segmented control */}
        <div style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '20px 36px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--fg-3)' }}>Wiki</div>
          <div style={{ display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: 3 }}>
            <SegBtn active={sub === 'briefing'} onClick={() => setSub('briefing')}>Briefing</SegBtn>
            <SegBtn active={sub === 'inbox'} onClick={() => setSub('inbox')}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                Inbox
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', borderRadius: 99, background: 'var(--accent-soft)', color: 'var(--accent-text)', fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{inboxBadge}</span>
              </span>
            </SegBtn>
            <SegBtn active={sub === 'packs'} onClick={() => setSub('packs')}>Packs</SegBtn>
          </div>
        </div>

        {sub === 'briefing' && (
          <BriefingTab
            loading={wikiLoading}
            source={source}
            needsYouCount={needsYouCount}
            attentionCards={attentionCards}
            followUps={followUps}
            tasksLeft={tasksLeft}
            onToggleFollowUp={toggleFollowUp}
            worthRemembering={worthRemembering}
            dreamSessions={dreamSessions}
            newestMemory={stats?.newestMemory ?? null}
          />
        )}
        {sub === 'inbox' && (
          <InboxTab fragments={inboxFragments} loading={wikiLoading} topics={topics} />
        )}
        {sub === 'packs' && (
          <PacksTab installed={installed} onToggle={togglePack} />
        )}
      </div>
    </div>
  );
}

/* ─────────────── Briefing tab ─────────────── */

function BriefingTab({
  loading, source, needsYouCount, attentionCards, followUps, tasksLeft,
  onToggleFollowUp, worthRemembering, dreamSessions, newestMemory,
}: {
  loading: boolean;
  source: 'live' | 'mock';
  needsYouCount: number;
  attentionCards: AttentionCard[];
  followUps: FollowUp[];
  tasksLeft: number;
  onToggleFollowUp: (id: string) => void;
  worthRemembering: Memory[];
  dreamSessions: number | null;
  newestMemory: string | null;
}) {
  const itemsNeedingYou = needsYouCount + tasksLeft;
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '42px 36px 90px' }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)', marginBottom: 13 }}>
        Briefing · prepared just now · {itemsNeedingYou} {itemsNeedingYou === 1 ? 'item needs' : 'items need'} you
        {source === 'mock' ? ' · demo data' : ''}
      </div>
      <h1 style={{ margin: '0 0 11px', fontSize: 32, fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--fg)', lineHeight: 1.12 }}>
        Here's what I've been keeping track of
      </h1>
      <p style={{ margin: '0 0 40px', fontSize: 16, lineHeight: 1.6, color: 'var(--fg-2)', maxWidth: 600 }}>
        The pieces that matter, pulled to the top — what needs a decision, what to follow up on, and what's worth keeping in mind.
      </p>

      {/* NEEDS YOUR ATTENTION */}
      <section style={{ marginBottom: 42 }}>
        <SectionHead color={C_ATTN} title="Needs your attention" count={attentionCards.length} />
        {attentionCards.length === 0 ? (
          <EmptyNote>
            {loading ? 'Reading your memory…' : 'Nothing needs a decision right now. No open contradictions or fading high-value memories.'}
          </EmptyNote>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {attentionCards.map((c) => (
              <div key={c.key} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: c.glyphBg, color: c.glyphColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', fontSize: 15 }}>{c.glyph}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>{c.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--fg-2)', lineHeight: 1.5 }}>{c.body}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--fg-3)', marginTop: 8 }}>{c.meta}</div>
                </div>
                {c.variant === 'primary' ? (
                  <button className="pbtn" style={btnPrimary}>{c.action}</button>
                ) : (
                  <button className="gbtn" style={btnGhost}>{c.action}</button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* FOLLOW-UPS */}
      <section style={{ marginBottom: 42 }}>
        <SectionHead color={C_TASK} title="Follow-ups I noted for you" trailing={`${tasksLeft} left`} />
        {followUps.length === 0 ? (
          <EmptyNote>{loading ? 'Reading your memory…' : 'No follow-ups noted.'}</EmptyNote>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {followUps.map((t, i) => (
              <div key={t.id} style={{ display: 'flex', gap: 13, alignItems: 'flex-start', padding: '13px 2px', borderBottom: i === followUps.length - 1 ? 'none' : '1px solid var(--hairline)' }}>
                <button onClick={() => onToggleFollowUp(t.id)} style={checkboxStyle(t.done)} aria-pressed={t.done}>
                  {t.done ? '✓' : ''}
                </button>
                <div style={{ flex: 1 }}>
                  <div style={taskLabelStyle(t.done)}>{t.text}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--fg-3)', marginTop: 5 }}>{t.meta}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* WORTH REMEMBERING */}
      <section style={{ marginBottom: 42 }}>
        <SectionHead color={C_KEEP} title="Worth remembering" />
        {worthRemembering.length === 0 ? (
          <EmptyNote>{loading ? 'Reading your memory…' : 'No high-importance memories yet.'}</EmptyNote>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {worthRemembering.map((m) => {
              const ts = typeStyle(m.memory_type);
              return (
                <div key={m.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: ts.color, flex: 'none', marginTop: 6 }} />
                  <div style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--fg)' }}>{m.summary || m.content}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* WHILE YOU WERE AWAY */}
      <section>
        <SectionHead color={C_DREAM} title="While you were away" />
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 11 }}>
            <span style={{ color: C_DREAM, fontSize: 14 }}>◈</span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg)' }}>
              Dream cycle{newestMemory ? ` · last activity ${relTime(newestMemory)} ago` : ''}
            </span>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 14.5, lineHeight: 1.6, color: 'var(--fg-2)' }}>
            {dreamSessions != null && dreamSessions > 0
              ? `I've run ${dreamSessions.toLocaleString()} dream ${dreamSessions === 1 ? 'cycle' : 'cycles'} — consolidating loose fragments into topics and letting low-importance memories fade. Nothing important was lost.`
              : 'No dream cycle has run yet. Once your memory grows, I consolidate fragments and let low-value memories fade here.'}
          </p>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <DreamStat value={dreamSessions != null ? dreamSessions.toLocaleString() : '—'} label="dream cycles" />
            <DreamStat value="—" label="fragments merged" />
            <DreamStat value="0" label="important lost" color={C_KEEP} />
          </div>
        </div>
      </section>
    </div>
  );
}

/* ─────────────── Inbox tab ─────────────── */

function InboxTab({ fragments, loading, topics }: { fragments: Fragment[]; loading: boolean; topics: Topic[] }) {
  const topicColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of topics) m.set(t.id, t.color);
    return m;
  }, [topics]);

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 36 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Inbox</h2>
      <p style={{ margin: '0 0 26px', fontSize: 14, color: 'var(--fg-2)' }}>Fragments waiting to be curated into topics. Conflicts are flagged.</p>
      {fragments.length === 0 ? (
        <EmptyNote>{loading ? 'Reading your memory…' : 'Inbox zero — every fragment has been curated.'}</EmptyNote>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {fragments.map((f) => {
            const isConflict = f.status === 'conflict';
            const dot = (f.topic && topicColor.get(f.topic)) || dotForActor(f.actor);
            return (
              <div key={f.id} className="row" style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: '15px 18px', transition: 'background .12s' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot, flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: 'var(--fg)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.reframed || f.raw}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>{f.source} · {f.time}</div>
                </div>
                {isConflict && (
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: C_ATTN, background: 'rgba(245,158,11,0.14)', padding: '3px 9px', borderRadius: 6 }}>Conflict</span>
                )}
                {isConflict ? (
                  <button className="pbtn" style={{ ...btnPrimary, fontSize: 11.5, padding: '7px 12px', borderRadius: 7 }}>Curate →</button>
                ) : (
                  <button className="gbtn" style={{ ...btnGhost, fontSize: 11.5, padding: '7px 12px', borderRadius: 7 }}>Assign topic</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Packs tab ─────────────── */

function PacksTab({ installed, onToggle }: { installed: Set<string>; onToggle: (id: string) => void }) {
  const installedCount = PACK_CATALOG.filter((p) => installed.has(p.id)).length;
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 36 }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Topic packs</h2>
      <p style={{ margin: '0 0 26px', fontSize: 14, color: 'var(--fg-2)' }}>
        Install taxonomies that organize memories into topics automatically.
        {installedCount === 0 ? ' None installed yet.' : ''}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {PACK_CATALOG.map((p) => {
          const isOn = installed.has(p.id);
          return (
            <div key={p.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{p.name}</span>
                {isOn && (
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: C_KEEP, background: 'rgba(16,185,129,0.14)', padding: '3px 9px', borderRadius: 6 }}>Installed</span>
                )}
              </div>
              <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--fg-3)', lineHeight: 1.5 }}>{p.topics} topics · {p.blurb}</p>
              {isOn ? (
                <button className="gbtn" onClick={() => onToggle(p.id)} style={{ ...btnGhost, fontSize: 11.5, padding: '7px 13px', borderRadius: 7 }}>Uninstall</button>
              ) : (
                <button className="pbtn" onClick={() => onToggle(p.id)} style={{ ...btnPrimary, fontSize: 11.5, padding: '7px 13px', borderRadius: 7 }}>Install</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────── Small presentational pieces ─────────────── */

function RailLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--fg-3)', padding: '0 10px', marginBottom: 8 }}>
      {children}
    </div>
  );
}

function RailRow({ color, label, count, active, strong }: { color: string; label: string; count?: number; active?: boolean; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, background: active ? 'var(--surface-2)' : 'transparent' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flex: 'none' }} />
      <span style={{ flex: 1, fontSize: 13, fontWeight: strong ? 600 : 500, color: strong ? 'var(--fg)' : 'var(--fg-2)' }}>{label}</span>
      {count != null && (
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>{count}</span>
      )}
    </div>
  );
}

function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="pbtn"
      onClick={onClick}
      style={{
        fontSize: 12.5, fontWeight: 600, border: 'none', borderRadius: 7, padding: '6px 13px', cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--accent-fg)' : 'var(--fg-2)',
        transition: 'background .12s, color .12s',
      }}
    >
      {children}
    </button>
  );
}

function SectionHead({ color, title, count, trailing }: { color: string; title: string; count?: number; trailing?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>{title}</span>
      {count != null && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>{count}</span>}
      {trailing && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>{trailing}</span>}
    </div>
  );
}

function DreamStat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 600, color: color ?? 'var(--fg)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px', fontSize: 13.5, color: 'var(--fg-3)', lineHeight: 1.55 }}>
      {children}
    </div>
  );
}

/* ─────────────── Style helpers ─────────────── */

const btnPrimary: CSSProperties = {
  flex: 'none', fontSize: 12, fontWeight: 600, color: 'var(--accent-fg)', background: 'var(--accent)',
  border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
};

const btnGhost: CSSProperties = {
  flex: 'none', fontSize: 12, fontWeight: 600, color: 'var(--fg-2)', background: 'transparent',
  border: '1px solid var(--border-2)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
};

function checkboxStyle(done: boolean): CSSProperties {
  return {
    width: 19, height: 19, flex: 'none', marginTop: 1, borderRadius: 6, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 700, lineHeight: 1,
    border: done ? 'none' : '1.5px solid var(--border-2)',
    background: done ? 'var(--accent)' : 'transparent',
    color: done ? 'var(--accent-fg)' : 'transparent',
    transition: 'background .12s, border-color .12s',
  };
}

function taskLabelStyle(done: boolean): CSSProperties {
  return {
    fontSize: 14, color: done ? 'var(--fg-3)' : 'var(--fg)',
    textDecoration: done ? 'line-through' : 'none',
    lineHeight: 1.4,
  };
}

/* ─────────────── Pure helpers ─────────────── */

function trimText(s: string | null | undefined, max = 140): string {
  const text = (s ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function labelType(t: string): string {
  return typeStyle(t).label.toLowerCase();
}

function dotForActor(actor: Fragment['actor']): string {
  return actor === 'agent' ? '#4466ff' : '#10b981';
}
