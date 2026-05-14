import { useEffect, useMemo, useState } from 'react';
import type { Fragment, Topic } from './wiki-data';
import type { CuratedArticle } from './showcase-articles';

export type WikiTabId = 'today' | 'wiki' | 'graph' | 'inbox';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onTab: (tab: WikiTabId) => void;
  onTopic: (id: string) => void;
  onSection?: (topicId: string, sectionId: string) => void;
  topics: Topic[];
  fragments: Fragment[];
  articles: CuratedArticle[];
}

interface SectionMatch {
  topicId: string;
  topicName: string;
  topicColor: string;
  sectionId: string;
  sectionTitle: string;
}

export function CommandPalette({
  open, onClose, onTab, onTopic, onSection, topics, fragments, articles,
}: CommandPaletteProps) {
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Note: parent remounts the palette via `key={open ? 'open' : 'closed'}`,
  // so query state is reset automatically on each open — no effect needed.

  const ql = q.toLowerCase().trim();

  const topicMatches = useMemo(() => {
    if (ql.length === 0) return topics.slice(0, 5);
    return topics
      .filter((t) =>
        t.name.toLowerCase().includes(ql) ||
        t.summary.toLowerCase().includes(ql))
      .slice(0, 5);
  }, [ql, topics]);

  const sectionMatches = useMemo<SectionMatch[]>(() => {
    if (ql.length === 0) return [];
    const out: SectionMatch[] = [];
    for (const article of articles) {
      const topic = topics.find((t) => t.id === article.topicId);
      if (!topic) continue;
      for (const section of article.sections) {
        if (section.title.toLowerCase().includes(ql) ||
            section.id.toLowerCase().includes(ql)) {
          out.push({
            topicId: article.topicId,
            topicName: topic.name,
            topicColor: topic.color,
            sectionId: section.id,
            sectionTitle: section.title,
          });
        }
      }
    }
    return out.slice(0, 6);
  }, [ql, topics, articles]);

  const fragmentMatches = useMemo(() => {
    if (ql.length === 0) return fragments.filter((f) => f.status === 'pending' || f.status === 'conflict').slice(0, 4);
    return fragments
      .filter((f) =>
        f.raw.toLowerCase().includes(ql) ||
        (f.reframed?.toLowerCase().includes(ql) ?? false) ||
        f.source.toLowerCase().includes(ql))
      .slice(0, 5);
  }, [ql, fragments]);

  if (!open) return null;

  const handleSection = (m: SectionMatch) => {
    onTopic(m.topicId);
    onTab('wiki');
    onClose();
    // Wait for the new topic to render, then scroll the section into view.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(m.sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    onSection?.(m.topicId, m.sectionId);
  };

  return (
    <div className="wk-cmd-scrim" onClick={onClose}>
      <div className="wk-cmd" onClick={(e) => e.stopPropagation()}>
        <div className="wk-cmd__input-row">
          <span style={{ fontSize: 14, color: 'var(--text-faint)' }}>⌕</span>
          <input
            autoFocus
            className="wk-cmd__input"
            placeholder="Search topics, sections, fragments…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="wk-cmd__esc">ESC</span>
        </div>

        <div className="wk-cmd__list">
          {ql.length === 0 && (
            <div className="wk-cmd__group-head">Topics</div>
          )}
          {ql.length > 0 && topicMatches.length > 0 && (
            <div className="wk-cmd__group-head">Topics · {topicMatches.length}</div>
          )}
          {topicMatches.map((t, i) => (
            <button
              key={t.id}
              className={`wk-cmd__row ${i === 0 && ql.length > 0 ? 'is-active' : ''}`}
              onClick={() => { onTopic(t.id); onTab('wiki'); onClose(); }}
            >
              <span className="wk-cmd__icon" style={{ color: t.color }}>●</span>
              <div>
                <div className="wk-cmd__title">{t.name}</div>
                <div className="wk-cmd__subtitle">{t.summary}</div>
              </div>
              <span className="wk-cmd__kind">Topic</span>
            </button>
          ))}

          {sectionMatches.length > 0 && (
            <>
              <div className="wk-cmd__group-head">Sections · {sectionMatches.length}</div>
              {sectionMatches.map((m) => (
                <button
                  key={`${m.topicId}-${m.sectionId}`}
                  className="wk-cmd__row"
                  onClick={() => handleSection(m)}
                >
                  <span className="wk-cmd__icon" style={{ color: m.topicColor }}>§</span>
                  <div>
                    <div className="wk-cmd__title">{m.sectionTitle}</div>
                    <div className="wk-cmd__subtitle">in {m.topicName}</div>
                  </div>
                  <span className="wk-cmd__kind">Section</span>
                </button>
              ))}
            </>
          )}

          {fragmentMatches.length > 0 && (
            <>
              <div className="wk-cmd__group-head">
                Fragments · {fragmentMatches.length}
                {ql.length === 0 && ' awaiting attention'}
              </div>
              {fragmentMatches.map((f) => (
                <button
                  key={f.id}
                  className="wk-cmd__row"
                  onClick={() => { onTab('inbox'); onClose(); }}
                >
                  <span className="wk-cmd__icon">◇</span>
                  <div>
                    <div className="wk-cmd__title">
                      {f.raw.slice(0, 80)}{f.raw.length > 80 ? '…' : ''}
                    </div>
                    <div className="wk-cmd__subtitle">{f.source} · {f.time} · {f.status}</div>
                  </div>
                  <span className="wk-cmd__kind">{f.id.slice(0, 12)}</span>
                </button>
              ))}
            </>
          )}

          {ql.length > 0 && topicMatches.length === 0 && sectionMatches.length === 0 && fragmentMatches.length === 0 && (
            <div className="wk-cmd__empty">Nothing matches "{q}".</div>
          )}

          <div className="wk-cmd__group-head">Actions</div>
          <button className="wk-cmd__row" onClick={() => { onTab('graph'); onClose(); }}>
            <span className="wk-cmd__icon">◈</span>
            <div>
              <div className="wk-cmd__title">Open Brain Map</div>
              <div className="wk-cmd__subtitle">force-directed graph view</div>
            </div>
            <span className="wk-cmd__kind">⌘G</span>
          </button>
          <button className="wk-cmd__row" onClick={() => { onTab('inbox'); onClose(); }}>
            <span className="wk-cmd__icon">↘</span>
            <div>
              <div className="wk-cmd__title">Open Inbox</div>
              <div className="wk-cmd__subtitle">
                {fragments.filter((f) => f.status === 'pending' || f.status === 'conflict').length} fragments awaiting attention
              </div>
            </div>
            <span className="wk-cmd__kind">⌘I</span>
          </button>
        </div>
      </div>
    </div>
  );
}
