import type { Memory } from '../../types/memory';
import type { Topic } from './wiki-data';
import type { CuratedArticle } from './showcase-articles';
import type { ContradictionPair } from './use-wiki-data';
import { prettySource, relativeTime } from './use-wiki-data';

// "Across everything" — the wiki's home page. Reads as a Sunday-morning
// briefing: what changed this week, what's open, what was decided. Pulls
// from every topic and surfaces only the things worth surfacing.
interface SummaryViewProps {
  topics: Topic[];
  memories: Memory[];
  articles: CuratedArticle[];
  contradictions: ContradictionPair[];
  onTopic: (topicId: string) => void;
}

export function SummaryView({ topics, memories, articles, contradictions, onTopic }: SummaryViewProps) {
  const topicLookup = new Map(topics.map((t) => [t.id, t]));

  // Sort memories by recency for the headlines feed.
  const recent = [...memories]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  // Pull `action` and `question` sections from every curated article.
  const needsAttention = articles.flatMap((a) =>
    a.sections
      .filter((s) => s.kind === 'action' || s.kind === 'question')
      .map((s) => ({ topic: topicLookup.get(a.topicId), section: s, kind: s.kind })),
  ).filter((x) => x.topic);

  const decisions = articles.flatMap((a) =>
    a.sections
      .filter((s) => s.kind === 'decision')
      .map((s) => ({ topic: topicLookup.get(a.topicId), section: s })),
  ).filter((x) => x.topic);

  const highlights = articles.flatMap((a) =>
    a.sections
      .filter((s) => s.kind === 'highlight')
      .map((s) => ({ topic: topicLookup.get(a.topicId), section: s })),
  ).filter((x) => x.topic);

  return (
    <div className="wk-summary">
      <header
        className="wk-hero wk-hero--summary"
        style={{ ['--wk-cluster-color' as string]: 'var(--brand)' }}
      >
        <span className="wk-hero__bar" aria-hidden />
        <div className="wk-hero__inner">
          <h1 className="wk-hero__title">Across everything</h1>
          <p className="wk-hero__lede">
            A weekly briefing on what your memory has been collecting — what changed,
            what's open, what you decided. Click any item to jump into the full topic.
          </p>
          <div className="wk-hero__meta">
            <span><strong>{topics.length}</strong> topics</span>
            <span className="wk-hero__meta-sep">·</span>
            <span><strong>{memories.length}</strong> notes total</span>
            <span className="wk-hero__meta-sep">·</span>
            <span><strong>{needsAttention.length}</strong> needing attention</span>
          </div>
        </div>
      </header>

      {/* Top tile row — the "dashboard" feel ─────────────────────────── */}
      <div className="wk-summary__tiles">
        <Tile
          accent="#f59e0b"
          glyph="?"
          label="Open questions"
          value={needsAttention.filter((x) => x.kind === 'question').length}
        />
        <Tile
          accent="var(--brand)"
          glyph="☐"
          label="To-do items"
          value={needsAttention.filter((x) => x.kind === 'action').length}
        />
        <Tile
          accent="#ef4444"
          glyph="⚠"
          label="Disagreements"
          value={contradictions.length}
        />
        <Tile
          accent="#10b981"
          glyph="✓"
          label="What's working"
          value={highlights.length}
        />
        <Tile
          accent="#8b5cf6"
          glyph="★"
          label="Decisions made"
          value={decisions.length}
        />
      </div>

      {/* Needs attention ─────────────────────────────────────────────── */}
      <section className="wk-summary__section">
        <h2 className="wk-summary__h2">
          <span className="wk-summary__h2-glyph" style={{ color: '#f59e0b' }}>?</span>
          Needs your attention
        </h2>
        <p className="wk-summary__caption">
          Open questions and to-do items pulled from across every topic. Pick what to act on.
        </p>
        <div className="wk-summary__cards">
          {needsAttention.length === 0 ? (
            <div className="wk-empty">Nothing pending. Enjoy it.</div>
          ) : (
            needsAttention.map(({ topic, section, kind }) => (
              <button
                key={`${topic!.id}-${section.id}`}
                type="button"
                className={`wk-summary__card wk-summary__card--${kind}`}
                onClick={() => onTopic(topic!.id)}
              >
                <div className="wk-summary__card-eyebrow">
                  <span className="wk-summary__card-dot" style={{ background: topic!.color }} />
                  <span>{topic!.name}</span>
                  <span className="wk-summary__card-tag">{kind === 'action' ? 'TO DO' : 'OPEN'}</span>
                </div>
                <div className="wk-summary__card-title">{section.title}</div>
                <div className="wk-summary__card-snip">
                  {firstProseSnippet(section.prose)}
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {/* Headlines ───────────────────────────────────────────────────── */}
      <section className="wk-summary__section">
        <h2 className="wk-summary__h2">
          <span className="wk-summary__h2-glyph" style={{ color: 'var(--brand)' }}>◇</span>
          This week's headlines
        </h2>
        <p className="wk-summary__caption">
          The most recent notes your agent has captured, across every topic.
        </p>
        <div className="wk-summary__feed">
          {recent.map((m) => {
            const topic = m.tags?.[0] ? topicLookup.get(m.tags[0]) : undefined;
            return (
              <button
                key={m.id}
                type="button"
                className="wk-summary__feed-row"
                onClick={() => topic && onTopic(topic.id)}
              >
                {topic && (
                  <span className="wk-summary__feed-tag" style={{ borderColor: topic.color, color: topic.color }}>
                    {topic.name}
                  </span>
                )}
                <span className="wk-summary__feed-text">
                  {(m.summary || m.content || '').slice(0, 150)}
                  {(m.summary || m.content || '').length > 150 ? '…' : ''}
                </span>
                <span className="wk-summary__feed-time">
                  from your {prettySource(m.source)} · {relativeTime(m.created_at)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* What's working + decisions ──────────────────────────────────── */}
      <div className="wk-summary__split">
        <section className="wk-summary__section">
          <h2 className="wk-summary__h2">
            <span className="wk-summary__h2-glyph" style={{ color: '#10b981' }}>✓</span>
            What's working
          </h2>
          <p className="wk-summary__caption">
            Patterns that have shown up across multiple notes — strong enough to act on.
          </p>
          <div className="wk-summary__list">
            {highlights.length === 0 ? (
              <div className="wk-empty">No clear patterns yet.</div>
            ) : (
              highlights.map(({ topic, section }) => (
                <button
                  key={`${topic!.id}-${section.id}`}
                  type="button"
                  className="wk-summary__list-row"
                  onClick={() => onTopic(topic!.id)}
                >
                  <span className="wk-summary__list-dot" style={{ background: topic!.color }} />
                  <span className="wk-summary__list-topic">{topic!.name}</span>
                  <span className="wk-summary__list-section">{section.title}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="wk-summary__section">
          <h2 className="wk-summary__h2">
            <span className="wk-summary__h2-glyph" style={{ color: '#8b5cf6' }}>★</span>
            Recently decided
          </h2>
          <p className="wk-summary__caption">
            Things you've actually made a call on — so you don't relitigate them later.
          </p>
          <div className="wk-summary__list">
            {decisions.length === 0 ? (
              <div className="wk-empty">No recent decisions logged.</div>
            ) : (
              decisions.map(({ topic, section }) => (
                <button
                  key={`${topic!.id}-${section.id}`}
                  type="button"
                  className="wk-summary__list-row"
                  onClick={() => onTopic(topic!.id)}
                >
                  <span className="wk-summary__list-dot" style={{ background: topic!.color }} />
                  <span className="wk-summary__list-topic">{topic!.name}</span>
                  <span className="wk-summary__list-section">{section.title}</span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Tile({ accent, glyph, label, value }: {
  accent: string; glyph: string; label: string; value: number;
}) {
  return (
    <div className="wk-summary__tile" style={{ ['--wk-tile-accent' as string]: accent }}>
      <div className="wk-summary__tile-glyph">{glyph}</div>
      <div className="wk-summary__tile-value">{value}</div>
      <div className="wk-summary__tile-label">{label}</div>
    </div>
  );
}

function firstProseSnippet(prose: { kind: string; text?: string; items?: string[] }[]): string {
  for (const block of prose) {
    if (block.kind === 'p' && block.text) {
      return strip(block.text).slice(0, 140) + (block.text.length > 140 ? '…' : '');
    }
    if (block.kind === 'callout' && block.text) {
      return strip(block.text).slice(0, 140) + (block.text.length > 140 ? '…' : '');
    }
    if (block.kind === 'list' && block.items?.length) {
      return strip(block.items[0]).slice(0, 140);
    }
  }
  return '';
}

function strip(text: string): string {
  return text
    .replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_m, slug, label) => label ?? slug)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}
