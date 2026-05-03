import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { WikiTab } from './WikiTab';
import { InboxTab } from './InboxTab';
import { GraphTab, type GraphLayout } from './GraphTab';
import { CommandPalette, type WikiTabId } from './CommandPalette';
import { useWikiData } from './use-wiki-data';
import { useTopicArticle } from './use-topic-article';
import { SHOWCASE_ARTICLES } from './showcase-articles';
import { SummaryView } from './SummaryView';
import { PackManager } from './PackManager';
import { packForTopic } from './wiki-packs';
import './Wiki.css';

const SUMMARY_TOPIC_ID = '__summary__';

// Topics worth flagging in the rail with the small attention dot — any topic
// whose curated article has at least one `action`/`question`-kind section, or
// whose memory pool has unresolved contradictions involving its tag.
function computeAttentionTopics(contradictionTags: Set<string>): Set<string> {
  const out = new Set<string>(contradictionTags);
  for (const article of SHOWCASE_ARTICLES) {
    if (article.sections.some((s) => s.kind === 'action' || s.kind === 'question')) {
      out.add(article.topicId);
    }
  }
  return out;
}

type Density = 'comfortable' | 'compact';

export function Wiki({ showcase = false }: { showcase?: boolean }) {
  const location = useLocation();
  const standalone = location.pathname.startsWith('/showcase');
  const [installedPacks, setInstalledPacks] = useState<string[]>(['workspace']);
  const [packsOpen, setPacksOpen] = useState(false);
  const wiki = useWikiData({ showcase, installedPacks });
  const { topics, fragments, graph, memories, contradictions } = wiki;

  const [tab, setTab] = useState<WikiTabId>('wiki');
  // Default landing is the cross-topic summary view, accessible via a special
  // pill at the head of the topic rail.
  const [activeTopic, setActiveTopic] = useState<string>(SUMMARY_TOPIC_ID);
  const isSummary = activeTopic === SUMMARY_TOPIC_ID;
  const activeTopicObj = isSummary ? null : (topics.find((t) => t.id === activeTopic) ?? topics[0] ?? null);
  const topicData = useTopicArticle(activeTopicObj, topics, memories, contradictions);

  const tabDefs: { id: WikiTabId; label: string; icon: string; count: number }[] = [
    { id: 'wiki',  label: 'Wiki',      icon: '▤', count: topicData.article?.sections.length ?? 0 },
    { id: 'graph', label: 'Brain Map', icon: '◈', count: graph.nodes.length },
    { id: 'inbox', label: 'Inbox',     icon: '↘', count: fragments.filter((f) => f.status === 'pending' || f.status === 'conflict').length },
  ];
  const [cmdOpen, setCmdOpen] = useState(false);
  const [graphLayout, setGraphLayout] = useState<GraphLayout>('force');
  const [density, setDensity] = useState<Density>('comfortable');
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const tweaksRef = useRef<HTMLDivElement>(null);

  // ⌘K / ctrl-K — open command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // close tweaks dropdown on outside click
  useEffect(() => {
    if (!tweaksOpen) return;
    const onClick = (e: MouseEvent) => {
      if (tweaksRef.current && !tweaksRef.current.contains(e.target as Node)) {
        setTweaksOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [tweaksOpen]);

  return (
    <div className={`wk-page ${standalone ? 'is-standalone' : ''}`}>
      <div className={`wk-app ${density === 'compact' ? 'is-compact' : ''}`}>
        <TopicRail
          topics={topics}
          active={activeTopic}
          summaryActive={isSummary}
          summaryTopicId={SUMMARY_TOPIC_ID}
          attentionTopicIds={computeAttentionTopics(
            new Set(contradictions.flatMap((p) => [...(p.a.tags || []), ...(p.b.tags || [])])),
          )}
          onSelect={(id) => {
            setActiveTopic(id);
            setTab('wiki');
          }}
        />
        <DataBanner source={wiki.source} loading={wiki.loading} error={wiki.error} />

        <div className="wk-main">
          <div className="wk-tabbar">
            {tabDefs.map((t) => (
              <button
                key={t.id}
                className={`wk-tab ${tab === t.id ? 'is-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <span style={{ fontSize: 13, opacity: 0.7 }}>{t.icon}</span>
                <span>{t.label}</span>
                <span className="wk-tab__count">{t.count}</span>
              </button>
            ))}
            <div className="wk-tabbar__right">
              {/* Packs are wired into showcase mode only — live /wiki sources
                  topics from the KG API, not from pack manifests yet. Hide
                  the affordance so users don't see a no-op control. */}
              {showcase && (
                <button
                  className="wk-iconbtn wk-iconbtn--text"
                  onClick={() => setPacksOpen((v) => !v)}
                  title="Memory packs"
                  aria-pressed={packsOpen}
                >
                  <span aria-hidden>▦</span> Packs · {installedPacks.length}
                </button>
              )}
              <button className="wk-search" onClick={() => setCmdOpen(true)}>
                <span className="wk-search__icon">⌕</span>
                <span>Search wiki, fragments…</span>
                <span className="wk-search__hint">⌘K</span>
              </button>
              <div ref={tweaksRef} style={{ position: 'relative' }}>
                <button
                  className="wk-iconbtn"
                  title="View tweaks"
                  aria-pressed={tweaksOpen}
                  onClick={() => setTweaksOpen((v) => !v)}
                >
                  ⚙
                </button>
                {tweaksOpen && (
                  <TweaksMenu
                    graphLayout={graphLayout}
                    onGraphLayout={setGraphLayout}
                    density={density}
                    onDensity={setDensity}
                  />
                )}
              </div>
            </div>
          </div>

          {tab === 'wiki' && isSummary && (
            <SummaryView
              topics={topics}
              memories={memories}
              articles={SHOWCASE_ARTICLES}
              contradictions={contradictions}
              onTopic={(id) => setActiveTopic(id)}
            />
          )}
          {tab === 'wiki' && !isSummary && (
            <WikiTab
              article={topicData.article}
              backlinks={topicData.backlinks}
              recentEdits={topicData.recentEdits}
              contradictions={topicData.contradictions}
              loading={topicData.loading}
              onTopic={(id) => setActiveTopic(id)}
            />
          )}
          {tab === 'graph' && <GraphTab layout={graphLayout} nodes={graph.nodes} edges={graph.edges} topics={topics} />}
          {tab === 'inbox' && <InboxTab fragments={fragments} topics={topics} contradictions={contradictions} />}
        </div>

        {packsOpen && (
          <PackManager
            installed={installedPacks}
            onToggle={(id) => setInstalledPacks((cur) =>
              cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id],
            )}
            onClose={() => setPacksOpen(false)}
          />
        )}

        <CommandPalette
          key={cmdOpen ? 'open' : 'closed'}
          open={cmdOpen}
          onClose={() => setCmdOpen(false)}
          onTab={setTab}
          onTopic={(id) => setActiveTopic(id)}
          topics={topics}
          fragments={fragments}
          articles={SHOWCASE_ARTICLES}
        />
      </div>
    </div>
  );
}

function TopicRail({
  topics, active, summaryActive, summaryTopicId, attentionTopicIds, onSelect,
}: {
  topics: { id: string; name: string; color: string; count: number }[];
  active: string;
  summaryActive: boolean;
  summaryTopicId: string;
  attentionTopicIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="wk-topics">
      <button
        className={`wk-topic-pill wk-topic-pill--summary ${summaryActive ? 'is-active' : ''}`}
        onClick={() => onSelect(summaryTopicId)}
      >
        <span className="wk-topic-pill__icon" aria-hidden>↗</span>
        <span>Across everything</span>
      </button>
      <span className="wk-topics__divider" aria-hidden />
      {topics.map((t) => {
        const pack = packForTopic(t.id);
        const showPackBadge = pack && pack.id !== 'workspace';
        return (
          <button
            key={t.id}
            className={`wk-topic-pill ${active === t.id ? 'is-active' : ''}`}
            onClick={() => onSelect(t.id)}
            title={pack ? `From ${pack.name} pack` : undefined}
          >
            <span className="wk-topic-pill__dot" style={{ background: t.color }} />
            <span>{t.name}</span>
            <span className="wk-topic-pill__count">{t.count}</span>
            {showPackBadge && (
              <span className="wk-topic-pill__pack" title={`From ${pack!.name}`}>
                {pack!.vertical.toUpperCase()}
              </span>
            )}
            {attentionTopicIds.has(t.id) && (
              <span className="wk-topic-pill__attn" title="Has action items or open questions" aria-label="needs attention" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function DataBanner({
  source, loading, error,
}: { source: 'live' | 'mock'; loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div className="wk-data-banner is-loading">
        <span className="wk-data-banner__dot" />
        Loading from your brain…
      </div>
    );
  }
  if (error) {
    return (
      <div className="wk-data-banner is-error">
        <span className="wk-data-banner__dot" />
        Couldn't load live memory — showing demo data. {error}
      </div>
    );
  }
  if (source === 'mock') {
    return (
      <div className="wk-data-banner is-mock">
        <span className="wk-data-banner__dot" />
        Demo data — no recent memories or entities returned.
      </div>
    );
  }
  return null;
}

function TweaksMenu({
  graphLayout, onGraphLayout, density, onDensity,
}: {
  graphLayout: GraphLayout;
  onGraphLayout: (v: GraphLayout) => void;
  density: Density;
  onDensity: (v: Density) => void;
}) {
  return (
    <div className="wk-tweaks">
      <div className="wk-tweaks__group">
        <span className="wk-tweaks__label">Brain map layout</span>
        <div className="wk-tweaks__radio">
          {(['force', 'tree', 'grid'] as GraphLayout[]).map((v) => (
            <button
              key={v}
              className={graphLayout === v ? 'is-active' : ''}
              onClick={() => onGraphLayout(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="wk-tweaks__group">
        <span className="wk-tweaks__label">Density</span>
        <div className="wk-tweaks__radio">
          {(['comfortable', 'compact'] as Density[]).map((v) => (
            <button
              key={v}
              className={density === v ? 'is-active' : ''}
              onClick={() => onDensity(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
