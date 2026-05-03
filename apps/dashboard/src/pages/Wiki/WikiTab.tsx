import { useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import type { Memory } from '../../types/memory';
import {
  WIKI_ARTICLE,
  CONTRADICTIONS,
  type Contradiction,
} from './wiki-data';
import type { ArticleSection, Backlink, ProseBlock, RecentEdit, SectionKind, TopicArticle } from './use-topic-article';
import { prettySource, relativeTime } from './use-wiki-data';
import { SharePopover } from './SharePopover';
import { SHOWCASE_PERSISTENCE } from './showcase-data';

// Glyph + label for each section kind. Drives the §-style marker beside the
// section heading so the eye can spot section type without reading the title.
const SECTION_KIND_META: Record<SectionKind, { glyph: string; label: string }> = {
  overview:  { glyph: '§',  label: 'overview'   },
  highlight: { glyph: '✓',  label: 'working'    },
  concern:   { glyph: '◯',  label: 'not yet'    },
  question:  { glyph: '?',  label: 'open'       },
  action:    { glyph: '☐',  label: 'to do'      },
  decision:  { glyph: '★',  label: 'decided'    },
};

// Map a memory's source label to a small icon. Falls back to a generic glyph
// when no specific match exists. Helps users recognise WHERE a note came from
// at a glance — text vs voice note vs journal entry vs phone call.
function sourceIconFor(source: string): string {
  const s = source.toLowerCase();
  if (s.includes('text') || s.includes('sms')) return '✉';
  if (s.includes('call'))                       return '☎';
  if (s.includes('chat'))                       return '◈';
  if (s.includes('note'))                       return '✎';
  if (s.includes('plan'))                       return '☐';
  if (s.includes('voice'))                      return '◐';
  return '◦';
}

interface WikiTabProps {
  article: TopicArticle | null;
  backlinks: Backlink[];
  recentEdits: RecentEdit[];
  contradictions: Contradiction[];
  loading: boolean;
  onTopic?: (topicId: string) => void;
}

export function WikiTab({ article, backlinks, recentEdits, contradictions, loading, onTopic }: WikiTabProps) {
  // Demo article retained as fallback when nothing is wired up yet.
  if (!article) {
    return <DemoArticleBody />;
  }

  if (article.sections.length === 0 && !loading) {
    return (
      <div className="wk-wiki">
        <div className="wk-article">
          <div className="wk-empty" style={{ padding: 24 }}>
            No memories indexed under <strong>{article.title}</strong> yet.
            Add a memory tagged <code>{article.id}</code> or run a recall cycle to populate this article.
          </div>
        </div>
        <RightRail
          sections={article.sections.map((s) => ({ id: s.id, title: s.title }))}
          backlinks={backlinks}
          recentEdits={recentEdits}
        />
      </div>
    );
  }

  return (
    <div className="wk-wiki">
      <div className="wk-article">
        <ArticleHero article={article} />
        {loading && (
          <div className="wk-data-banner is-loading" style={{ marginBottom: 16 }}>
            <span className="wk-data-banner__dot" />
            Recalling memories for {article.title}…
          </div>
        )}
        {contradictions.length > 0 && (
          <section id="contradictions">
            <h2>Contradictions <span className="wk-section-count">· {contradictions.length}</span></h2>
            {contradictions.map((c, i) => (
              <ContradictionBlock key={`${c.aSrc}-${c.bSrc}-${i}`} data={c} />
            ))}
          </section>
        )}
        {article.sections.map((section) => (
          <SectionBlock
            key={section.id}
            section={section}
            contradictions={contradictions}
            onTopic={onTopic}
          />
        ))}
      </div>
      <RightRail
        sections={[
          ...(contradictions.length > 0 ? [{ id: 'contradictions', title: `Contradictions (${contradictions.length})` }] : []),
          ...article.sections.map((s) => ({ id: s.id, title: s.title })),
        ]}
        backlinks={backlinks}
        recentEdits={recentEdits}
        onTopic={onTopic}
      />
    </div>
  );
}

function ArticleHero({ article }: { article: TopicArticle }) {
  const [shareOpen, setShareOpen] = useState(false);
  const persistence = SHOWCASE_PERSISTENCE[article.id];

  return (
    <header
      className="wk-hero"
      style={{ ['--wk-cluster-color' as string]: article.color }}
    >
      <span className="wk-hero__bar" aria-hidden />
      <div className="wk-hero__inner">
        <div className="wk-hero__top">
          <h1 className="wk-hero__title">{article.title}</h1>
          <div className="wk-hero__actions">
            <button
              className="wk-hero__action wk-hero__action--primary"
              onClick={() => setShareOpen((v) => !v)}
              aria-expanded={shareOpen}
            >
              <span aria-hidden>↗</span>
              Share
            </button>
            {shareOpen && (
              <SharePopover
                topicId={article.id}
                topicName={article.title}
                onClose={() => setShareOpen(false)}
              />
            )}
          </div>
        </div>
        <p className="wk-hero__lede">{article.lede}</p>
        <div className="wk-hero__meta">
          <span>built from <strong>{article.meta.sources}</strong> {article.meta.sources === 1 ? 'note' : 'notes'}</span>
          <span className="wk-hero__meta-sep">·</span>
          <span>last updated <strong>{article.meta.updated}</strong></span>
        </div>
        {persistence && (
          <div className="wk-hero__persistence" title="Memory persistence — how long your agent has been remembering this topic">
            <span className="wk-hero__persistence-dot" aria-hidden />
            <span>
              Your agent has been tracking this for <strong>{persistence.days}</strong> {persistence.days === 1 ? 'day' : 'days'}
              {' '}across <strong>{persistence.conversations}</strong> {persistence.conversations === 1 ? 'conversation' : 'conversations'}
              {' '}({Array.from(persistence.sources).slice(0, 3).join(', ')}{persistence.sources.size > 3 ? '…' : ''}).
            </span>
          </div>
        )}
      </div>
    </header>
  );
}

function SectionBlock({ section, contradictions, onTopic }: {
  section: ArticleSection;
  contradictions: Contradiction[];
  onTopic?: (topicId: string) => void;
}) {
  const kind = section.kind ?? 'overview';
  const meta = SECTION_KIND_META[kind];
  return (
    <section id={section.id} className={`wk-section wk-section--${kind}`}>
      <header className="wk-section__head">
        <span className="wk-section__glyph" aria-hidden>{meta.glyph}</span>
        <h2 className="wk-section__title">{section.title}</h2>
        <span className="wk-section__kind-tag">{meta.label}</span>
      </header>
      <div className="wk-section__body">
        {section.prose
          ? section.prose.map((b, i) => (
              <ProseBlockRenderer
                key={i}
                block={b}
                memories={section.memories}
                contradictions={contradictions}
                onTopic={onTopic}
              />
            ))
          : section.memories.map((m) => <MemoryBlock key={m.id} memory={m} />)}
      </div>
    </section>
  );
}

function ProseBlockRenderer({
  block, memories, contradictions, onTopic,
}: {
  block: ProseBlock;
  memories: Memory[];
  contradictions: Contradiction[];
  onTopic?: (topicId: string) => void;
}) {
  if (block.kind === 'p') {
    return <p>{renderInline(block.text, onTopic)}</p>;
  }
  if (block.kind === 'reframe') {
    const memory = memories.find((m) => m.hash_id === block.memoryHash);
    if (!memory) return null;
    return <MemoryBlock memory={memory} />;
  }
  if (block.kind === 'contradiction') {
    if (contradictions.length === 0) return null;
    return <ContradictionBlock data={contradictions[0]} />;
  }
  if (block.kind === 'callout') {
    const cls = block.tone === 'question' ? 'wk-callout-q' : 'wk-callout';
    return <p className={cls}>{renderInline(block.text, onTopic)}</p>;
  }
  if (block.kind === 'list') {
    return (
      <ul>
        {block.items.map((item, i) => <li key={i}>{renderInline(item, onTopic)}</li>)}
      </ul>
    );
  }
  if (block.kind === 'code') {
    return <pre className="wk-code"><code>{block.text}</code></pre>;
  }
  return null;
}

// Inline formatting: **bold**, *italic*, `code`, [[topic-id|label]] wikilinks.
// Tiny enough to keep here; the alternative is a markdown lib pulled into the
// bundle just for these four primitives.
function renderInline(text: string, onTopic?: (topicId: string) => void): ReactNode[] {
  const tokens: ReactNode[] = [];
  const re = /(\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\])|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      tokens.push(text.slice(lastIdx, match.index));
    }
    if (match[1]) {
      const slug = match[2];
      const label = match[3] ?? slug;
      tokens.push(
        <button
          key={`k${key++}`}
          type="button"
          className="wk-wikilink"
          onClick={(e) => { e.preventDefault(); onTopic?.(slug); }}
        >
          {label}
        </button>,
      );
    } else if (match[4]) {
      tokens.push(<strong key={`k${key++}`}>{match[5]}</strong>);
    } else if (match[6]) {
      tokens.push(<em key={`k${key++}`}>{match[7]}</em>);
    } else if (match[8]) {
      tokens.push(<code key={`k${key++}`}>{match[9]}</code>);
    }
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) tokens.push(text.slice(lastIdx));
  return tokens;
}

function MemoryBlock({ memory }: { memory: Memory }) {
  const hasReframe = Boolean(memory.summary && memory.summary !== memory.content);
  if (hasReframe) {
    return (
      <Reframe
        author={prettySource(memory.source)}
        rawText={memory.content}
        reframedText={memory.summary}
        when={relativeTime(memory.created_at)}
      />
    );
  }
  return (
    <p className="wk-rawmem">
      <span className="wk-rawmem__src">
        <span aria-hidden>{sourceIconFor(prettySource(memory.source))}</span>
        From your {prettySource(memory.source)} · {relativeTime(memory.created_at)} ·
      </span>{' '}
      {memory.content}
    </p>
  );
}

interface ReframeProps {
  author: string;
  rawText: string;
  reframedText: string;
  when: string;
}

function Reframe({ author, rawText, reframedText, when }: ReframeProps) {
  const [accepted, setAccepted] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [body, setBody] = useState(reframedText);

  if (rejected) return null;

  return (
    <div className="wk-reframe">
      <div className="wk-reframe__head">
        <span className="wk-reframe__source-icon" aria-hidden>{sourceIconFor(author)}</span>
        <span>From your {author}</span>
        <span style={{ opacity: 0.6 }}>· {when}</span>
        <button
          type="button"
          className="wk-reframe__source-link"
          onClick={() => setShowDiff(!showDiff)}
        >
          {showDiff ? 'Hide what you said' : 'See what you said'}
        </button>
      </div>
      <div
        className="wk-reframe__body"
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => setBody(e.currentTarget.textContent || '')}
      >
        {body}
      </div>
      <div className="wk-reframe__actions">
        {!accepted && (
          <button className="wk-mini-btn wk-mini-btn--brand" onClick={() => setAccepted(true)}>
            ✓ Looks right
          </button>
        )}
        {accepted && (
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 9, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: 'var(--clude-success, #10b981)', fontWeight: 700,
          }}>
            ✓ Confirmed
          </span>
        )}
        <button className="wk-mini-btn">Edit</button>
        <button className="wk-mini-btn" style={{ marginLeft: 'auto' }} onClick={() => setRejected(true)}>
          Remove
        </button>
      </div>
      {showDiff && (
        <div className="wk-reframe__diff">
          <div className="wk-reframe__diff-col">
            <div className="wk-reframe__diff-label">your exact words · {when}</div>
            <div className="wk-reframe__diff-text">{rawText}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────── Backlinks / right rail ───────────

function RightRail({
  sections, backlinks, recentEdits, onTopic,
}: {
  sections: { id: string; title: string }[];
  backlinks: Backlink[];
  recentEdits: RecentEdit[];
  onTopic?: (topicId: string) => void;
}) {
  return (
    <aside className="wk-rail">
      <div className="wk-rail__panel">
        <div className="wk-rail__head"><div className="wk-eyebrow">On this page</div></div>
        <div className="wk-rail__body">
          <nav className="wk-toc">
            {sections.length === 0 ? (
              <div className="wk-empty">No sections yet.</div>
            ) : (
              sections.map((s, i) => (
                <a key={s.id} className={`wk-toc__item ${i === 0 ? 'is-active' : ''}`} href={`#${s.id}`}>
                  {s.title}
                </a>
              ))
            )}
          </nav>
        </div>
      </div>

      <div className="wk-rail__panel">
        <div className="wk-rail__head">
          <div className="wk-eyebrow">Backlinks · {backlinks.length}</div>
        </div>
        <div>
          {backlinks.length === 0 ? (
            <div className="wk-empty">No cross-references yet.</div>
          ) : (
            backlinks.map((b) => (
              <button
                key={b.id}
                type="button"
                className="wk-backlink"
                onClick={() => onTopic?.(b.id)}
              >
                <span className="wk-backlink__dot" style={{ background: b.color }} />
                <div>
                  <div className="wk-backlink__title">{b.title}</div>
                  <div className="wk-backlink__snip">{b.snip}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="wk-rail__panel">
        <div className="wk-rail__head"><div className="wk-eyebrow">Recent edits</div></div>
        <div className="wk-feed">
          {recentEdits.length === 0 ? (
            <div className="wk-empty">No recent activity.</div>
          ) : (
            recentEdits.map((e, i) => (
              <div key={i} className="wk-feed__row">
                <span className="wk-feed__icon">{e.icon}</span>
                <span className="wk-feed__text" dangerouslySetInnerHTML={{ __html: e.text }} />
                <span className="wk-feed__time">{e.time}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

// ─────────── Demo body (fallback when no live article) ───────────

function DemoArticleBody() {
  const article = WIKI_ARTICLE;
  return (
    <div className="wk-wiki">
      <div className="wk-article">
        <Section id="overview" title="Overview">
          <p>
            Clude does not store memories forever. Every memory has a <strong>decay factor</strong> that drifts toward zero
            over time, scaled by importance, recency, and access count. Retrieval reads decay as a <em>weight</em> —
            it does not delete; it makes things <em>colder</em>. <a className="wk-wikilink">Agent loops</a> read decay
            before deciding to recall, which is why the rates matter for behavior, not just storage cost.
          </p>
        </Section>
        <Section id="rates" title="Decay Rates">
          <ContradictionBlock data={CONTRADICTIONS[0]} />
        </Section>
      </div>
      <RightRail
        sections={article.sections}
        backlinks={[]}
        recentEdits={[]}
      />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ContradictionBlock({ data }: { data: Contradiction }) {
  const [state, setState] = useState<'idle' | 'pending' | 'resolved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  if (state === 'resolved') return null;

  const canResolve = data.aId != null && data.bId != null;

  const send = async (choice: 'adopt-newer' | 'adopt-older' | 'keep-both') => {
    if (!canResolve || data.aId == null || data.bId == null) return;
    setState('pending');
    setErrorMsg(null);
    try {
      await api.resolveContradiction({
        memoryAId: data.aId,
        memoryBId: data.bId,
        choice,
      });
      setState('resolved');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed');
      setState('error');
    }
  };

  return (
    <div className="wk-contradict">
      <div className="wk-contradict__head">
        <span>⚠</span>
        <span>Contradiction detected · 2 fragments disagree</span>
      </div>
      <div className="wk-contradict__rows">
        <div className="wk-contradict__row">
          <span className="wk-contradict__row-label">Older</span>
          <div>
            <div style={{ color: 'var(--text)', fontWeight: 600 }}>{data.a}</div>
            <div style={{ color: 'var(--text-faint)', marginTop: 2 }}>{data.aSrc}</div>
          </div>
        </div>
        <div className="wk-contradict__row">
          <span className="wk-contradict__row-label">Newer</span>
          <div>
            <div style={{ color: 'var(--text)', fontWeight: 600 }}>{data.b}</div>
            <div style={{ color: 'var(--text-faint)', marginTop: 2 }}>{data.bSrc}</div>
          </div>
        </div>
      </div>
      <div style={{
        marginTop: 10, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)',
      }}>
        Suggestion: <span style={{ color: 'var(--text)' }}>{data.suggestion}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button
          className="wk-mini-btn wk-mini-btn--brand"
          disabled={state === 'pending' || !canResolve}
          onClick={() => canResolve ? send('adopt-newer') : setState('resolved')}
        >
          Adopt newer
        </button>
        <button
          className="wk-mini-btn"
          disabled={state === 'pending' || !canResolve}
          onClick={() => canResolve ? send('adopt-older') : setState('resolved')}
        >
          Adopt older
        </button>
        <button
          className="wk-mini-btn"
          disabled={state === 'pending' || !canResolve}
          onClick={() => canResolve ? send('keep-both') : setState('resolved')}
        >
          Keep both
        </button>
      </div>
      {state === 'pending' && (
        <div className="wk-conflict__pending" style={{ marginTop: 8 }}>Storing resolution…</div>
      )}
      {state === 'error' && errorMsg && (
        <div className="wk-conflict__error" style={{ marginTop: 8 }}>Could not resolve: {errorMsg}</div>
      )}
    </div>
  );
}
