import type { ReactNode } from 'react';
import type { Memory } from '../../types/memory';
import type { Fragment, Topic } from './wiki-data';
import type { ContradictionPair, WikiData } from './use-wiki-data';
import type { WikiTabId } from './CommandPalette';

// Today tab — daily-driver Jarvis surface, ported from claude.ai/design and
// wired to live recall/contradictions/fragment data so the briefing reflects
// the user's actual memory rather than the design prototype's seed content.

type Props = {
  memories: Memory[];
  contradictions: ContradictionPair[];
  fragments: Fragment[];
  topics: Topic[];
  source: WikiData['source'];
  loading: boolean;
  onAsk: () => void;
  onTab: (tab: WikiTabId) => void;
};

const MS_PER_DAY = 86_400_000;
const TOPIC_COLOR_FALLBACK = '#2244FF';

export function TodayTab({
  memories, contradictions, fragments, topics, source, loading, onAsk, onTab,
}: Props) {
  const now = new Date();
  const view = buildTodayView(now, memories, contradictions, fragments, topics);
  const isEmpty = !loading && source === 'live' && memories.length === 0;

  return (
    <div className="wk-today">
      <TodayHero view={view} now={now} />
      {source === 'mock' && !loading && <DemoBanner />}
      {isEmpty ? (
        <EmptyState onAsk={onAsk} />
      ) : (
        <>
          <NowBar view={view} onAsk={onAsk} />
          <BriefingHero view={view} now={now} />
          <PrioritySection view={view} onTab={onTab} />
          <ResurfaceSection view={view} onTab={onTab} />
          <LoopsSection view={view} />
        </>
      )}
    </div>
  );
}

/* ============================================================
   View model — pure derivation from memory/contradictions/fragments
   ============================================================ */

interface PriorityCardModel {
  kind: 'decide' | 'ship' | 'notice';
  kindLabel: string;
  due: string;
  title: string;
  why: ReactNode;
  links: { label: string; time: string; color: string }[];
  actions: string[];
}

interface ResurfaceModel {
  when: string;
  whenSub: string;
  quote: string;
  whyTo: string;
  whyTopic: string;
  source: string;
  sourceColor: string;
  meta: string;
}

interface LoopModel {
  color: string;
  kind: string;
  age: string;
  q: string;
  sub: ReactNode;
}

interface TodayView {
  // hero stats
  memoryCount: number;
  newThisWeek: number;
  openLoopsCount: number;
  contradictionsCount: number;
  pendingFragmentCount: number;
  resurfacedCount: number;
  lastDreamLabel: string;
  highImportanceThisWeek: number;

  // now bar
  activeAgent: string | null;
  recentFragmentCount: number;

  // sections
  priorities: PriorityCardModel[];
  resurfaced: ResurfaceModel[];
  decisions: LoopModel[];
  motions: LoopModel[];
}

function buildTodayView(
  now: Date,
  memories: Memory[],
  contradictions: ContradictionPair[],
  fragments: Fragment[],
  topics: Topic[],
): TodayView {
  const topicById = new Map(topics.map((t) => [t.id, t]));
  const topicByName = new Map(topics.map((t) => [t.name.toLowerCase(), t]));
  const sevenDaysAgo = now.getTime() - 7 * MS_PER_DAY;
  const ninetyMinutesAgo = now.getTime() - 90 * 60_000;

  const sortedRecent = [...memories].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const recentWeek = sortedRecent.filter(
    (m) => new Date(m.created_at).getTime() >= sevenDaysAgo,
  );
  const highImpRecent = recentWeek.filter((m) => (m.importance ?? 0) >= 0.7);
  const pendingFragments = fragments.filter((f) => f.status === 'pending');
  const conflictFragments = fragments.filter((f) => f.status === 'conflict');
  const lastDream = sortedRecent.find((m) => m.memory_type === 'self_model');

  const recentFragmentCount = sortedRecent.filter((m) => {
    const t = new Date(m.created_at).getTime();
    return t >= ninetyMinutesAgo;
  }).length;

  const activeAgent = (() => {
    const lastAgent = sortedRecent.find((m) => m.source && m.source !== 'user');
    return lastAgent?.source ?? null;
  })();

  // Resurfaced: top by importance × low-decay × log(access), excluding very fresh
  const resurfaceCandidates = sortedRecent
    .filter((m) => {
      const ageMs = now.getTime() - new Date(m.created_at).getTime();
      return ageMs > MS_PER_DAY; // exclude today's own writes
    })
    .map((m) => ({
      mem: m,
      score:
        (m.importance ?? 0) * 0.6 +
        (m.decay_factor ?? 0) * 0.3 +
        Math.min(Math.log1p(m.access_count ?? 0) / 4, 0.1),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const resurfaced: ResurfaceModel[] = resurfaceCandidates.map(({ mem }) => {
    const when = formatRelativeShort(now, new Date(mem.created_at));
    const whenSub = formatDateShort(new Date(mem.created_at));
    const tag = mem.tags?.[0];
    const topic = tag ? topicByName.get(tag.toLowerCase()) : null;
    return {
      when: when.short,
      whenSub: when.sub || whenSub,
      quote: clip(mem.content || mem.summary, 220),
      whyTo: mem.summary || tag || 'today\'s focus',
      whyTopic: topic?.name ?? tag ?? 'Wiki',
      source: mem.source || 'memory',
      sourceColor: topic?.color ?? TOPIC_COLOR_FALLBACK,
      meta: `${mem.hash_id || `m-${mem.id}`} · imp ${(mem.importance ?? 0).toFixed(2)}`,
    };
  });

  // Open loops:
  //  - decisions awaiting: contradictions + any conflict-status fragments
  //  - in motion: pending fragments (waiting to be reframed)
  const decisions: LoopModel[] = [
    ...contradictions.slice(0, 3).map((c) => ({
      color: '#F59E0B',
      kind: 'Decision · awaiting',
      age: formatAge(now, new Date(c.a.createdAt)),
      q: pickContradictionTitle(c),
      sub: (
        <>
          <strong>2 sources</strong> · contradicting · <em>{clip(c.a.summary || c.a.content, 80)}</em> vs <em>{clip(c.b.summary || c.b.content, 80)}</em>.
        </>
      ),
    })),
    ...conflictFragments.slice(0, 3 - Math.min(contradictions.length, 3)).map((f) => ({
      color: '#EC4899',
      kind: 'Question · self',
      age: f.time || 'recent',
      q: clip(f.raw, 110),
      sub: <>Flagged from <strong>{f.source}</strong>. Needs review in inbox.</>,
    })),
  ].slice(0, 3);

  const motions: LoopModel[] = pendingFragments.slice(0, 3).map((f) => {
    const topic = f.topic ? topicById.get(f.topic) ?? topicByName.get(f.topic.toLowerCase()) : null;
    return {
      color: topic?.color ?? '#2244FF',
      kind: 'In motion',
      age: f.time || 'recent',
      q: clip(f.reframed || f.raw, 110),
      sub: (
        <>
          From <strong>{f.source}</strong>{topic ? <> · topic <strong>{topic.name}</strong></> : null}. Awaiting reframe.
        </>
      ),
    };
  });

  // Priority cards: derived heuristically from real data
  const priorities: PriorityCardModel[] = [];

  if (contradictions.length > 0) {
    const c = contradictions[0];
    const aTopic = topicByName.get((c.a.tags?.[0] || '').toLowerCase());
    const bTopic = topicByName.get((c.b.tags?.[0] || '').toLowerCase());
    priorities.push({
      kind: 'decide',
      kindLabel: 'Decide',
      due: contradictions.length > 1 ? `${contradictions.length} open` : 'Awaiting you',
      title: pickContradictionTitle(c),
      why: (
        <>
          Two memories disagree (strength <strong>{c.strength.toFixed(2)}</strong>). <em>{clip(c.a.summary || c.a.content, 100)}</em> vs <em>{clip(c.b.summary || c.b.content, 100)}</em>. Until you resolve this, downstream work depending on it stalls.
        </>
      ),
      links: [
        { label: clip(c.a.summary || c.a.content, 90), time: formatRelativeShort(now, new Date(c.a.createdAt)).short, color: aTopic?.color ?? '#10B981' },
        { label: clip(c.b.summary || c.b.content, 90), time: formatRelativeShort(now, new Date(c.b.createdAt)).short, color: bTopic?.color ?? '#8B5CF6' },
      ],
      actions: ['Open in inbox', 'Resolve'],
    });
  }

  const shipCandidate = highImpRecent.find(
    (m) => !contradictions.some((c) => c.a.id === m.id || c.b.id === m.id),
  ) ?? highImpRecent[0];
  if (shipCandidate) {
    priorities.push({
      kind: 'ship',
      kindLabel: 'Ship',
      due: 'High importance',
      title: shipCandidate.summary || clip(shipCandidate.content, 80),
      why: (
        <>
          Importance <strong>{(shipCandidate.importance ?? 0).toFixed(2)}</strong> · stored {formatRelativeShort(now, new Date(shipCandidate.created_at)).short}. <em>{clip(shipCandidate.content, 160)}</em>
        </>
      ),
      links: shipCandidate.tags?.slice(0, 3).map((tag) => {
        const t = topicByName.get(tag.toLowerCase());
        return { label: `#${tag}`, time: t ? `${t.count} memories` : '', color: t?.color ?? TOPIC_COLOR_FALLBACK };
      }) ?? [],
      actions: ['Open thread', 'Pull related'],
    });
  }

  const noticePattern = pickPatternMemory(recentWeek, topicByName);
  if (noticePattern) {
    priorities.push({
      kind: 'notice',
      kindLabel: 'Notice',
      due: 'Pattern',
      title: noticePattern.title,
      why: noticePattern.why,
      links: noticePattern.links,
      actions: ['Investigate', 'Snooze'],
    });
  }

  return {
    memoryCount: memories.length,
    newThisWeek: recentWeek.length,
    openLoopsCount: contradictions.length + pendingFragments.length + conflictFragments.length,
    contradictionsCount: contradictions.length,
    pendingFragmentCount: pendingFragments.length,
    resurfacedCount: resurfaced.length,
    lastDreamLabel: lastDream
      ? formatTimeShort(new Date(lastDream.created_at))
      : '—',
    highImportanceThisWeek: highImpRecent.length,
    activeAgent,
    recentFragmentCount,
    priorities,
    resurfaced,
    decisions,
    motions,
  };
}

function pickContradictionTitle(c: ContradictionPair): string {
  const aTag = c.a.tags?.[0];
  const bTag = c.b.tags?.[0];
  if (aTag && bTag && aTag === bTag) return `${titleCase(aTag)}: which way?`;
  if (aTag && bTag) return `${titleCase(aTag)} vs ${titleCase(bTag)}`;
  return clip(c.a.summary || c.a.content, 90);
}

function pickPatternMemory(
  recent: Memory[],
  topicByName: Map<string, Topic>,
): { title: string; why: ReactNode; links: PriorityCardModel['links'] } | null {
  // Find a tag that recurs in 3+ recent memories — that's a pattern worth noticing.
  const tagCounts = new Map<string, Memory[]>();
  for (const m of recent) {
    for (const tag of m.tags ?? []) {
      const arr = tagCounts.get(tag) ?? [];
      arr.push(m);
      tagCounts.set(tag, arr);
    }
  }
  const ranked = [...tagCounts.entries()]
    .filter(([, mems]) => mems.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);
  if (ranked.length === 0) return null;
  const [tag, mems] = ranked[0];
  const topic = topicByName.get(tag.toLowerCase());
  return {
    title: `Recurring: ${titleCase(tag)}`,
    why: (
      <>
        <strong>{mems.length} memories</strong> mention <em>{tag}</em> this week. {clip(mems[0].summary || mems[0].content, 140)}
      </>
    ),
    links: mems.slice(0, 3).map((m) => ({
      label: clip(m.summary || m.content, 80),
      time: formatRelativeShort(new Date(), new Date(m.created_at)).short,
      color: topic?.color ?? '#8B5CF6',
    })),
  };
}

/* ============================================================
   Formatting helpers
   ============================================================ */

function clip(s: string | undefined, n: number): string {
  if (!s) return '';
  const trimmed = s.trim();
  if (trimmed.length <= n) return trimmed;
  return trimmed.slice(0, n - 1).trimEnd() + '…';
}

function titleCase(s: string): string {
  return s.replace(/(^|\s|-|_)([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase()).replace(/[-_]/g, ' ');
}

function formatTimeShort(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatRelativeShort(now: Date, then: Date): { short: string; sub: string } {
  const diffMs = now.getTime() - then.getTime();
  const min = Math.round(diffMs / 60_000);
  if (min < 60) return { short: `${Math.max(min, 0)}m`, sub: 'ago' };
  const hrs = Math.round(min / 60);
  if (hrs < 24) return { short: `${hrs}h`, sub: 'ago' };
  const days = Math.round(hrs / 24);
  if (days < 7) return { short: `${days}d`, sub: 'ago' };
  if (days < 30) return { short: `${Math.round(days / 7)}w`, sub: 'ago' };
  return { short: formatDateShort(then), sub: `${Math.round(days / 30)} mo` };
}

function formatAge(now: Date, then: Date): string {
  const days = Math.floor((now.getTime() - then.getTime()) / MS_PER_DAY);
  if (days < 1) return 'today';
  if (days === 1) return '1 day open';
  if (days < 7) return `${days} days open`;
  if (days < 30) return `${Math.floor(days / 7)} wk open`;
  return `${Math.floor(days / 30)} mo open`;
}

function greeting(d: Date): string {
  const h = d.getHours();
  if (h < 5) return 'Working late, Seb';
  if (h < 12) return 'Good morning, Seb';
  if (h < 17) return 'Good afternoon, Seb';
  if (h < 22) return 'Good evening, Seb';
  return 'Still up, Seb';
}

function isoWeekNumber(d: Date): number {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
}

/* ============================================================
   Subcomponents
   ============================================================ */

function TodayHero({ view, now }: { view: TodayView; now: Date }) {
  return (
    <header className="wk-today-hero">
      <div className="wk-today-hero__left">
        <div className="wk-eyebrow">
          <span className="wk-eyebrow__crumb">JARVIS</span>
          <span className="wk-eyebrow__sep">/</span>
          <span style={{ color: 'var(--fg-1)' }}>TODAY</span>
        </div>
        <h1 className="wk-today-hero__title">
          <span className="wk-today-hero__glyph">◈</span>
          Today
          <span className="wk-today-hero__sub">
            · {formatDateShort(now)} · w{isoWeekNumber(now)}
          </span>
        </h1>
        <p className="wk-today-hero__lede">
          A live briefing from Clude — driven by your own memory state. Priorities, what's connected to today, and what's waiting on you.
        </p>
      </div>
      <div className="wk-today-hero__kv">
        <div>
          <span className="wk-kv__label">Mode</span>
          <span className="wk-kv__value" style={{ color: 'var(--clude-success)' }}>● LISTENING</span>
        </div>
        <div>
          <span className="wk-kv__label">Resurfaced</span>
          <span className="wk-kv__value">{view.resurfacedCount}</span>
        </div>
        <div>
          <span className="wk-kv__label">Open loops</span>
          <span className="wk-kv__value">{view.openLoopsCount}</span>
        </div>
        <div>
          <span className="wk-kv__label">Last dream</span>
          <span className="wk-kv__value">{view.lastDreamLabel}</span>
        </div>
      </div>
    </header>
  );
}

function NowBar({ view, onAsk }: { view: TodayView; onAsk: () => void }) {
  return (
    <div className="wk-nowbar">
      <div className="wk-nowbar__pulse">
        <span className="wk-nowbar__pulse-dot" />
        <span>Active now</span>
      </div>
      <div>
        <div className="wk-nowbar__what">
          {view.activeAgent
            ? <>Recent activity from <strong>{view.activeAgent}</strong></>
            : <>You have <strong>{view.memoryCount.toLocaleString()}</strong> memories in your brain</>
          }
        </div>
        <div className="wk-nowbar__what-meta">
          {view.recentFragmentCount} fragment{view.recentFragmentCount === 1 ? '' : 's'} stored in last 90 min · {view.pendingFragmentCount} awaiting reframe
        </div>
      </div>
      <div className="wk-nowbar__chips">
        <button type="button" className="wk-nowbar__chip">+ Capture thought</button>
        <button type="button" className="wk-nowbar__chip" onClick={onAsk}>✦ Reframe</button>
        <button type="button" className="wk-nowbar__chip">◇ Dream cycle</button>
      </div>
    </div>
  );
}

function BriefingHero({ view, now }: { view: TodayView; now: Date }) {
  const briefingSentence = computeBriefing(view);
  return (
    <section className="wk-brief">
      <div className="wk-brief__main">
        <div className="wk-brief__greeting">
          <span className="wk-brief__greeting-dot" />
          <span>{greeting(now)} · briefing · {formatTimeShort(now)}</span>
        </div>
        <p className="wk-brief__line">{briefingSentence}</p>
        <ul className="wk-brief__bullets">
          <li>
            <span className="wk-brief__bullet-glyph">◇</span>
            <span><strong>{view.resurfacedCount} past memor{view.resurfacedCount === 1 ? 'y' : 'ies'}</strong> resurfaced by importance and decay</span>
            <span className="wk-brief__bullet-time">{formatTimeShort(now)}</span>
          </li>
          <li>
            <span className="wk-brief__bullet-glyph">⚠</span>
            <span><strong>{view.contradictionsCount} contradiction{view.contradictionsCount === 1 ? '' : 's'}</strong> awaiting resolution</span>
            <span className="wk-brief__bullet-time">{view.contradictionsCount > 0 ? 'now' : '—'}</span>
          </li>
          <li>
            <span className="wk-brief__bullet-glyph">✦</span>
            <span><strong>{view.newThisWeek} new memor{view.newThisWeek === 1 ? 'y' : 'ies'}</strong> this week · {view.highImportanceThisWeek} high-importance</span>
            <span className="wk-brief__bullet-time">7d</span>
          </li>
        </ul>
      </div>
      <aside className="wk-brief__side">
        <div className="wk-brief__date">
          <span className="wk-brief__date-day">{now.toLocaleDateString(undefined, { weekday: 'short' })} {now.getDate()}</span>
          <span className="wk-brief__date-meta">{now.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} · w{isoWeekNumber(now)}</span>
        </div>
        <div className="wk-brief__stat-row">
          <span className="wk-brief__stat-label">Memories</span>
          <span className="wk-brief__stat-value">{view.memoryCount.toLocaleString()}</span>
          <span className="wk-brief__stat-sub">+{view.newThisWeek} this week · {view.highImportanceThisWeek} high-importance</span>
        </div>
        <div className="wk-brief__stat-row">
          <span className="wk-brief__stat-label">Open loops</span>
          <span className="wk-brief__stat-value">{view.openLoopsCount}</span>
          <span className="wk-brief__stat-sub">{view.contradictionsCount} contradiction{view.contradictionsCount === 1 ? '' : 's'} · {view.pendingFragmentCount} pending fragment{view.pendingFragmentCount === 1 ? '' : 's'}</span>
        </div>
        <div className="wk-brief__stat-row">
          <span className="wk-brief__stat-label">Last dream</span>
          <span className="wk-brief__stat-value" style={{ fontSize: 18, lineHeight: 1.3 }}>{view.lastDreamLabel}</span>
          <span className="wk-brief__stat-sub">most-recent self_model write</span>
        </div>
      </aside>
    </section>
  );
}

function computeBriefing(view: TodayView): ReactNode {
  const parts: ReactNode[] = [];
  if (view.contradictionsCount > 0) {
    parts.push(
      <span key="c"><strong>{view.contradictionsCount} contradiction{view.contradictionsCount === 1 ? '' : 's'}</strong> awaiting resolution. </span>,
    );
  }
  if (view.highImportanceThisWeek > 0) {
    parts.push(
      <span key="h"><strong>{view.highImportanceThisWeek} high-importance memor{view.highImportanceThisWeek === 1 ? 'y' : 'ies'}</strong> this week — the most-recent ones are surfaced below. </span>,
    );
  }
  if (view.pendingFragmentCount > 0) {
    parts.push(
      <span key="p"><strong>{view.pendingFragmentCount} fragment{view.pendingFragmentCount === 1 ? '' : 's'}</strong> in the inbox waiting to be reframed. </span>,
    );
  }
  if (parts.length === 0) {
    return (
      <>
        Nothing urgent. <strong>{view.memoryCount.toLocaleString()}</strong> memor{view.memoryCount === 1 ? 'y' : 'ies'} in your brain — capture more and I'll start surfacing patterns.
      </>
    );
  }
  return <>{parts}</>;
}

function PrioritySection({ view, onTab }: { view: TodayView; onTab: (tab: WikiTabId) => void }) {
  if (view.priorities.length === 0) {
    return (
      <section>
        <div className="wk-today__sectionhead">
          <div>
            <div className="wk-today__sectionhead-eyebrow">What matters today</div>
            <h2>Nothing actionable yet</h2>
          </div>
          <span className="wk-today__sectionhead-meta">no contradictions or high-importance memories yet</span>
        </div>
      </section>
    );
  }
  return (
    <section>
      <div className="wk-today__sectionhead">
        <div>
          <div className="wk-today__sectionhead-eyebrow">What matters today</div>
          <h2>{view.priorities.length === 1 ? 'One thing' : view.priorities.length === 2 ? 'Two things' : 'Three things'}, in priority order</h2>
        </div>
        <span className="wk-today__sectionhead-meta">ranked by contradiction strength × importance × pattern recurrence</span>
      </div>
      <div className="wk-priority" style={view.priorities.length < 3 ? { gridTemplateColumns: `repeat(${view.priorities.length}, 1fr)` } : undefined}>
        {view.priorities.map((p, i) => (
          <PriorityCard key={i} model={p} onTab={onTab} />
        ))}
      </div>
    </section>
  );
}

function PriorityCard({ model, onTab }: { model: PriorityCardModel; onTab: (tab: WikiTabId) => void }) {
  return (
    <article className="wk-priocard">
      <div className="wk-priocard__head">
        <span className={`wk-priocard__kind wk-priocard__kind--${model.kind}`}>{model.kindLabel}</span>
        <span className="wk-priocard__due">{model.due}</span>
      </div>
      <h3 className="wk-priocard__title">{model.title}</h3>
      <p className="wk-priocard__why">{model.why}</p>
      <div className="wk-priocard__links">
        {model.links.map((l, i) => (
          <div key={i} className="wk-priocard__link">
            <span className="wk-cdot" style={{ background: l.color, width: 6, height: 6, borderRadius: '50%' }} />
            <span className="wk-priocard__link-label">{l.label}</span>
            <span className="wk-priocard__link-time">{l.time}</span>
          </div>
        ))}
      </div>
      <div className="wk-priocard__actions">
        {model.actions.map((a, i) => (
          <button
            key={a}
            type="button"
            className={`wk-mini-btn ${i === 0 ? 'wk-mini-btn--brand' : ''}`}
            onClick={() => {
              if (a.toLowerCase().includes('inbox')) onTab('inbox');
              else if (a.toLowerCase().includes('thread') || a.toLowerCase().includes('related')) onTab('wiki');
            }}
          >
            {a}
          </button>
        ))}
      </div>
    </article>
  );
}

function ResurfaceSection({ view, onTab }: { view: TodayView; onTab: (tab: WikiTabId) => void }) {
  if (view.resurfaced.length === 0) {
    return null;
  }
  return (
    <section>
      <div className="wk-today__sectionhead">
        <div>
          <div className="wk-today__sectionhead-eyebrow">Pulled forward</div>
          <h2>Past memories that connect to today</h2>
        </div>
        <span className="wk-today__sectionhead-meta">scored by importance × decay × access</span>
      </div>
      <div className="wk-spine">
        <div className="wk-spine__memories">
          {view.resurfaced.map((r, i) => (
            <div key={i} className="wk-resurface" onClick={() => onTab('wiki')} style={{ cursor: 'pointer' }}>
              <div className="wk-resurface__when">
                <strong>{r.when}</strong>
                {r.whenSub}
              </div>
              <div className="wk-resurface__body">
                <p className="wk-resurface__quote">{r.quote}</p>
                <div className="wk-resurface__why">
                  <span className="wk-resurface__why-glyph">↳</span>
                  <span className="wk-resurface__why-target">in <strong>{r.whyTopic}</strong> · {r.whyTo}</span>
                </div>
              </div>
              <div className="wk-resurface__meta">
                <div className="wk-resurface__source">
                  <span className="wk-cdot" style={{ background: r.sourceColor, width: 7, height: 7, borderRadius: '50%' }} />
                  <span>{r.source}</span>
                </div>
                <span>{r.meta}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function LoopsSection({ view }: { view: TodayView }) {
  if (view.decisions.length === 0 && view.motions.length === 0) {
    return null;
  }
  return (
    <section>
      <div className="wk-today__sectionhead">
        <div>
          <div className="wk-today__sectionhead-eyebrow">Open loops</div>
          <h2>Decisions awaiting · work in motion</h2>
        </div>
        <span className="wk-today__sectionhead-meta">{view.openLoopsCount} open</span>
      </div>
      <div className="wk-loops">
        <div className="wk-loops__col">
          {view.decisions.length > 0 ? (
            view.decisions.map((d, i) => <LoopCard key={i} {...d} />)
          ) : (
            <div className="wk-loop"><p className="wk-loop__sub">No contradictions or self-questions.</p></div>
          )}
        </div>
        <div className="wk-loops__col">
          {view.motions.length > 0 ? (
            view.motions.map((d, i) => <LoopCard key={i} {...d} />)
          ) : (
            <div className="wk-loop"><p className="wk-loop__sub">Inbox is clear.</p></div>
          )}
        </div>
      </div>
    </section>
  );
}

function LoopCard({ color, kind, age, q, sub }: LoopModel) {
  return (
    <article className="wk-loop">
      <div className="wk-loop__head">
        <span className="wk-cdot" style={{ background: color, width: 8, height: 8, borderRadius: '50%' }} />
        <span>{kind}</span>
        <span className="wk-loop__head-age">{age}</span>
      </div>
      <p className="wk-loop__q">{q}</p>
      <p className="wk-loop__sub">{sub}</p>
      <div className="wk-loop__foot">
        <button type="button" className="wk-mini-btn">Open</button>
        <button type="button" className="wk-mini-btn">Snooze</button>
        <button type="button" className="wk-mini-btn">Resolve</button>
      </div>
    </article>
  );
}

function DemoBanner() {
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'var(--bg-2)',
        border: '1px dashed var(--line-strong)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.08em',
        color: 'var(--fg-3)',
      }}
    >
      ◇ DEMO DATA — showing sample memories. Connect an agent to see your real brain.
    </div>
  );
}

function EmptyState({ onAsk }: { onAsk: () => void }) {
  return (
    <section
      style={{
        border: '1px solid var(--line)',
        padding: '40px 32px',
        background: 'var(--bg-1)',
        textAlign: 'center',
      }}
    >
      <h2 style={{ fontSize: 20, margin: 0, marginBottom: 8 }}>Nothing in your brain yet</h2>
      <p style={{ color: 'var(--fg-2)', maxWidth: 560, margin: '0 auto 16px', lineHeight: 1.55 }}>
        Today gets interesting once Clude has memories to chew on — open loops, contradictions, recurring patterns. Capture a thought or connect an agent and come back.
      </p>
      <button type="button" className="wk-mini-btn wk-mini-btn--brand" onClick={onAsk}>Ask Clude</button>
    </section>
  );
}
