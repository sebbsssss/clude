import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

// Ask Clude — slide-out conversational panel that reads from the brain.
// Ported from the claude.ai/design Clude Knowledge Wiki handoff. Mock
// content for now; will hook into the recall pipeline / chat API later.

type ChatMode = 'ask' | 'recall' | 'draft' | 'decide';
type Source = { id: string; title: string; time: string; color: string };
type Reframe = { title: string; body: string };

type ThreadMessage =
  | { role: 'user'; text: string; time: string }
  | {
      role: 'clude';
      confidence: number;
      body: ReactNode;
      sources?: Source[];
      reframe?: Reframe;
      actions?: string[];
      time: string;
    };

const SEED_THREAD: ThreadMessage[] = [
  {
    role: 'user',
    text: 'should we go per-token or per-memory pricing? i need to decide before friday.',
    time: '9:18 AM',
  },
  {
    role: 'clude',
    confidence: 0.86,
    body: (
      <>
        <p>You and <strong>@anya</strong> have been on opposite sides of this for 6 weeks. Here's what your brain actually says:</p>
        <ul>
          <li><strong>Per-token</strong> is what you wrote at 11pm on Monday — your reasoning was that it's the only unit that scales with actual compute cost.</li>
          <li><strong>Per-memory</strong> is what Anya proposed at standup Tuesday — her argument was incentive alignment with the user's value.</li>
        </ul>
        <p>I think you're both <em>partially right</em>. Your worry about per-memory was over-engineering it; her worry about per-token was that heavy users pay for context they don't access. The <em>March 30</em> note suggests you privately agreed with her more than you let on.</p>
        <p>My recommendation: <strong>per-token base + a memory-cap on free tier.</strong> That resolves both objections and is one slide in the deck, not a chapter.</p>
      </>
    ),
    sources: [
      { id: 'f-094', title: "11pm doc — 'per-token is the only honest unit'", time: 'Mon 11:08pm', color: '#8B5CF6' },
      { id: 'f-051', title: "Anya — 'per-memory keeps incentives honest'", time: 'Tue 4:12pm', color: '#10B981' },
      { id: 'f-022', title: "Mar 30 — 'didn't push back enough'", time: '6 wk ago', color: '#EC4899' },
      { id: 'f-002', title: '@Cludebot — pricing conflict flagged', time: '34m ago', color: '#2244FF' },
    ],
    reframe: {
      title: 'Draft for Billing Model wiki',
      body:
        'Pricing model: per-token base with a memory-cap on free tier. Resolves the per-memory incentive concern (Anya, Tue) and the per-token cost-scaling concern (Seb, Mon 11pm) without forcing a single mental model on the user.',
    },
    actions: ['Save as decision', 'Add to deck slide 7', 'Schedule talk w/ Anya', 'Show how I got here'],
    time: '9:18 AM',
  },
];

const SUGGESTIONS_BY_MODE: Record<ChatMode, { glyph: string; label: string }[]> = {
  ask: [
    { glyph: '?', label: 'Why did I say the opposite of this last month?' },
    { glyph: '?', label: 'What do Anya and I actually disagree about?' },
    { glyph: '?', label: "What am I missing for Friday's call?" },
  ],
  recall: [
    { glyph: '↶', label: 'Pull every pricing fragment from the last 60 days' },
    { glyph: '↶', label: 'What did I say after the last investor call?' },
    { glyph: '↶', label: 'All @Cludebot patterns flagged this month' },
  ],
  draft: [
    { glyph: '✎', label: 'Draft slide 7 (pricing) for the deck' },
    { glyph: '✎', label: 'Write the README section on decay' },
    { glyph: '✎', label: "Compose a reply to Anya's proposal" },
  ],
  decide: [
    { glyph: '▶', label: 'Force a decision: pick a billing model now' },
    { glyph: '▶', label: 'Block half a day for consolidation rewrite' },
    { glyph: '▶', label: 'Snooze the decay-tunable question 2 weeks' },
  ],
};

export function AskCludePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<ChatMode>('ask');
  const [thread, setThread] = useState<ThreadMessage[]>(SEED_THREAD);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [thread, thinking]);

  const send = (text?: string) => {
    const msg = (text ?? draft).trim();
    if (!msg) return;
    setThread((t) => [...t, { role: 'user', text: msg, time: 'now' }]);
    setDraft('');
    setThinking(true);
    window.setTimeout(() => {
      setThinking(false);
      setThread((t) => [
        ...t,
        {
          role: 'clude',
          confidence: 0.78,
          body: (
            <p>
              Searching across <strong>1,284 memories</strong>… I'd ground this in your earlier fragments and pull a clean answer. (In a real run this would stream Clude's reply tied to specific memory IDs.)
            </p>
          ),
          sources: [{ id: 'f-***', title: 'matched 3 fragments by topic + entity', time: 'now', color: '#2244FF' }],
          actions: ['Save to wiki', 'Refine'],
          time: 'now',
        },
      ]);
    }, 1200);
  };

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className={`wk-ask-scrim ${open ? 'is-open' : ''}`}>
      <div className="wk-ask-scrim__veil" onClick={onClose} />
      <aside className="wk-ask" role="dialog" aria-label="Ask Clude" aria-hidden={!open}>
        <header className="wk-ask__head">
          <div className="wk-ask__topbar">
            <h2 className="wk-ask__title">
              <span className="wk-ask__title-glyph" />
              Ask Clude
            </h2>
            <span className="wk-ask__meta">grounded in 1,284 memories</span>
            <button type="button" className="wk-ask__close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className="wk-ask__modes">
            {([
              { id: 'ask',    label: 'Ask',    glyph: '?' },
              { id: 'recall', label: 'Recall', glyph: '↶' },
              { id: 'draft',  label: 'Draft',  glyph: '✎' },
              { id: 'decide', label: 'Decide', glyph: '▶' },
            ] as { id: ChatMode; label: string; glyph: string }[]).map((m) => (
              <button
                key={m.id}
                type="button"
                className={`wk-ask__mode ${mode === m.id ? 'is-active' : ''}`}
                onClick={() => setMode(m.id)}
              >
                <span className="wk-ask__mode-glyph">{m.glyph}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </header>

        <div className="wk-ask__body" ref={bodyRef}>
          <div className="wk-ask__day-divider">Today · 9:18 AM</div>
          {thread.map((m, i) => (m.role === 'user' ? <UserMsg key={i} m={m} /> : <CludeMsg key={i} m={m} />))}
          {thinking && (
            <div className="wk-ask-thinking">
              <span className="wk-ask-thinking__dots"><span /><span /><span /></span>
              <span>searching brain · weighting by recency × relevance × decay…</span>
            </div>
          )}
        </div>

        <footer className="wk-ask__foot">
          <div className="wk-ask__suggestions">
            {SUGGESTIONS_BY_MODE[mode].map((s, i) => (
              <button key={i} type="button" className="wk-ask__suggestion" onClick={() => send(s.label)}>
                <span className="wk-ask__suggestion-glyph">{s.glyph}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
          <div className="wk-ask__composer">
            <div className="wk-ask__input-row">
              <textarea
                className="wk-ask__input"
                placeholder="Ask your second brain · @ to mention an agent or entity"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onComposerKey}
                rows={2}
              />
              <button type="button" className="wk-ask__send" onClick={() => send()} aria-label="Send">↵</button>
            </div>
            <div className="wk-ask__hints">
              <span><kbd>⌘</kbd><kbd>↵</kbd> send</span>
              <span><kbd>@</kbd> mention</span>
              <span><kbd>/</kbd> command</span>
              <span style={{ marginLeft: 'auto', color: 'var(--clude-success)', letterSpacing: '0.16em' }}>● recording context</span>
            </div>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function UserMsg({ m }: { m: Extract<ThreadMessage, { role: 'user' }> }) {
  return (
    <div className="wk-msg-user">
      <div className="wk-msg-user__bubble">{m.text}</div>
      <div className="wk-msg-user__time">{m.time} · Seb</div>
    </div>
  );
}

function CludeMsg({ m }: { m: Extract<ThreadMessage, { role: 'clude' }> }) {
  return (
    <div className="wk-msg-clude">
      <div className="wk-msg-clude__head">
        <span className="wk-msg-clude__avatar">C</span>
        <span>Clude</span>
        <span className="wk-msg-clude__conf">confidence <strong>{m.confidence.toFixed(2)}</strong></span>
      </div>
      <div className="wk-msg-clude__body">{m.body}</div>

      {m.sources && (
        <div className="wk-msg-clude__sources">
          <div className="wk-msg-clude__sources-head">⟁ {m.sources.length} memories pulled from your brain</div>
          {m.sources.map((s, i) => (
            <div key={i} className="wk-msg-clude__source">
              <span className="wk-cdot" style={{ background: s.color, width: 8, height: 8, borderRadius: '50%' }} />
              <span className="wk-msg-clude__source-title">{s.title}</span>
              <span className="wk-msg-clude__source-meta">{s.time}</span>
              <span className="wk-msg-clude__source-id">{s.id}</span>
            </div>
          ))}
        </div>
      )}

      {m.reframe && (
        <div className="wk-ask-reframe">
          <div className="wk-ask-reframe__head">
            <span>✦ Reframe ready</span>
            <span className="wk-ask-reframe__tag">{m.reframe.title}</span>
          </div>
          <div className="wk-ask-reframe__body">{m.reframe.body}</div>
          <div className="wk-ask-reframe__actions">
            <button type="button" className="wk-mini-btn wk-mini-btn--brand">✓ Save to wiki</button>
            <button type="button" className="wk-mini-btn">Edit</button>
            <button type="button" className="wk-mini-btn">Discard</button>
          </div>
        </div>
      )}

      {m.actions && (
        <div className="wk-msg-clude__actions">
          {m.actions.map((a, i) => (
            <button key={a} type="button" className={`wk-mini-btn ${i === 0 ? 'wk-mini-btn--brand' : ''}`}>{a}</button>
          ))}
        </div>
      )}
    </div>
  );
}
