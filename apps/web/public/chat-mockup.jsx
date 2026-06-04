/* global React */
// chat-mockup.jsx — one continuous conversation across models.
// Messages accumulate; model dropdown flips mid-thread; memory panel constant.

const { useState, useEffect, useRef } = React;

// ────────────────────────────────────────────────────────────────────────────
// Model marks
// ────────────────────────────────────────────────────────────────────────────
function ClaudeMark({ size = 18 }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#D97757" />
      <g fill="#FFFFFF">
        <ellipse cx="16" cy="16" rx="2.3" ry="9" />
        <ellipse cx="16" cy="16" rx="2.3" ry="9" transform="rotate(45 16 16)" />
        <ellipse cx="16" cy="16" rx="2.3" ry="9" transform="rotate(90 16 16)" />
        <ellipse cx="16" cy="16" rx="2.3" ry="9" transform="rotate(135 16 16)" />
      </g>
    </svg>
  );
}
function GPTMark({ size = 18 }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#0F1714" />
      <g fill="none" stroke="#10A37F" strokeWidth="1.6" strokeLinejoin="round">
        <polygon points="16,7 22,10.5 22,17.5 16,21 10,17.5 10,10.5" />
        <polygon points="16,11 22,14.5 22,21.5 16,25 10,21.5 10,14.5" />
      </g>
    </svg>
  );
}
function GeminiMark({ size = 18 }) {
  const gid = "gemgrad-" + (Math.random() * 1e6 | 0);
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="60%" stopColor="#7C5CFB" />
          <stop offset="100%" stopColor="#D96CCC" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="16" fill={`url(#${gid})`} />
      <path
        fill="#FFFFFF"
        d="M16 5 C16 11 17 15 27 16 C17 17 16 21 16 27 C16 21 15 17 5 16 C15 15 16 11 16 5 Z"
      />
    </svg>
  );
}

const MODELS = [
  { id: "claude", name: "Claude · Sonnet 4.5", color: "#D97757", accent: "rgba(217,119,87,0.16)", Logo: ClaudeMark },
  { id: "gpt",    name: "ChatGPT · GPT-5",     color: "#10A37F", accent: "rgba(16,163,127,0.16)", Logo: GPTMark },
  { id: "gemini", name: "Gemini · 2.5 Pro",    color: "#4285F4", accent: "rgba(66,133,244,0.16)", Logo: GeminiMark },
];

// ────────────────────────────────────────────────────────────────────────────
// One coherent conversation, threaded across models
// ────────────────────────────────────────────────────────────────────────────
const TIMELINE = [
  { kind: "user",   model: 0, text: "Pick up where we left off on the dashboard work." },
  { kind: "agent",  model: 0,
    text: "On it. Last week you blocked progress on the memory-graph hover state. Want to start there, or finish the timeline view first?",
    recalls: [
      { type: "semantic",   text: "user prefers dense dashboards" },
      { type: "episodic",   text: "blocked: memory-graph hover (4d ago)" },
      { type: "procedural", text: "always confirm before scope expansion" },
    ],
  },
  { kind: "user",   model: 0, text: "Hover state. What was I deciding on?" },
  { kind: "switch", from: 0,  to: 1 },
  { kind: "agent",  model: 1,
    text: "Picking up the thread. From your reflection on May 11: 200ms reveal with a tooltip showing bond-type label. You ruled out the click-to-pin variant. Ship that?",
    recalls: [
      { type: "introspective", text: "reflection May 11 · 200ms reveal" },
      { type: "episodic",      text: "ruled out click-to-pin (felt heavy)" },
    ],
  },
  { kind: "user",   model: 1, text: "Yep. Then draft the deploy checklist." },
  { kind: "switch", from: 1,  to: 2 },
  { kind: "agent",  model: 2,
    text: "Following your procedural memory: 1) dream.run() to consolidate. 2) cross-browser test on Safari + Chrome. 3) sign and push. Reminder: you skip the changelog step and regret it.",
    recalls: [
      { type: "procedural", text: "deploy flow: consolidate → sign → push" },
      { type: "self-model", text: "tends to skip the changelog step" },
    ],
  },
];

const MEMORY_PANEL = [
  { type: "self-model",   text: "Calls me \"Seb\"; prefers short replies over long.", meta: "imp 1.00 · anchor" },
  { type: "semantic",     text: "Project: Clude main site. Stack: HTML, Funnel Sans.", meta: "imp 0.92 · consolidated" },
  { type: "episodic",     text: "Liked littlebird.ai storytelling, wanted to remix.", meta: "imp 0.81 · today" },
  { type: "procedural",   text: "Always preserve v1 when iterating.", meta: "imp 0.87 · 3 uses" },
  { type: "introspective", text: "Reflection: dense > card UI by ~3:1 in feedback.", meta: "imp 0.62 · dream:08" },
];

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────
function ChatMockup() {
  const [visible, setVisible] = useState(1);
  const [typed, setTyped] = useState("");
  const [typingDone, setTypingDone] = useState(false);
  const scrollRef = useRef(null);

  const last = TIMELINE[visible - 1];

  // Active model = walk backwards from current visible item
  const activeModelIdx = (() => {
    for (let i = visible - 1; i >= 0; i--) {
      const s = TIMELINE[i];
      if (s.kind === "switch") return s.to;
      if (s.kind === "user" || s.kind === "agent") return s.model;
    }
    return 0;
  })();
  const activeModel = MODELS[activeModelIdx];

  // Scroll the chat window when content grows
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [visible, typed, typingDone]);

  // Single async loop drives the whole timeline
  useEffect(() => {
    let cancelled = false;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function play() {
      // Reset state
      setVisible(1);
      setTyped("");
      setTypingDone(false);

      while (!cancelled) {
        for (let v = 1; v <= TIMELINE.length; v++) {
          if (cancelled) return;
          const item = TIMELINE[v - 1];

          setVisible(v);
          setTyped("");
          setTypingDone(false);

          if (item.kind === "user") {
            await sleep(1500);
          } else if (item.kind === "switch") {
            await sleep(1400);
          } else if (item.kind === "agent") {
            // small pause so the bubble mounts before typing
            await sleep(120);
            for (let i = 3; i <= item.text.length; i += 3) {
              if (cancelled) return;
              setTyped(item.text.slice(0, i));
              await sleep(14);
            }
            setTyped(item.text);
            await sleep(220);
            setTypingDone(true);
            await sleep(3200);
          }
        }
        // pause before looping
        await sleep(2400);
        // soft reset
        setVisible(0);
        await sleep(200);
      }
    }

    play();
    return () => {
      cancelled = true;
    };
  }, []);

  const ActiveLogo = activeModel.Logo;

  return (
    <div className="chat-mockup">
      <div className="chat-window-head">
        <span className="chat-dot r" />
        <span className="chat-dot y" />
        <span className="chat-dot g" />
        <div className="model-badge model-badge-dropdown" title="Switch model">
          <span className="model-badge-logo"><ActiveLogo size={16} /></span>
          <span className="model-badge-name">{activeModel.name}</span>
          <span className="model-badge-chev">▾</span>
        </div>
        <div className="chat-window-tabs">
          <span className="persistence-tag">● MEMORY ACTIVE</span>
        </div>
      </div>

      <div className="chat-window" ref={scrollRef}>
        {TIMELINE.slice(0, visible).map((s, i) => {
          if (s.kind === "switch") {
            const From = MODELS[s.from].Logo;
            const To = MODELS[s.to].Logo;
            return (
              <div className="model-switch-divider" key={`s-${i}`}>
                <span className="line" />
                <span className="label">
                  <From size={11} />
                  <span className="arrow">→</span>
                  <To size={11} />
                  <span>switched to {MODELS[s.to].name.split("·")[0].trim()}</span>
                </span>
                <span className="line" />
              </div>
            );
          }
          if (s.kind === "user") {
            return (
              <div className="chat-msg user" key={`u-${i}`}>
                <div className="chat-avatar">YOU</div>
                <div className="chat-bubble">{s.text}</div>
              </div>
            );
          }
          // agent
          const M = MODELS[s.model];
          const ML = M.Logo;
          const isThis = i === visible - 1;
          const isTypingHere = isThis && !typingDone;
          const textToShow = isThis ? (typed || (typingDone ? s.text : "")) : s.text;
          const showRecalls = (!isThis || typingDone) && s.recalls;
          return (
            <div className="chat-msg agent" key={`a-${i}`}>
              <div className="chat-avatar model-avatar" style={{ background: M.accent }}>
                <ML size={18} />
              </div>
              <div className="chat-bubble">
                {textToShow}
                {isTypingHere && <span className="caret">▍</span>}
                {showRecalls && (
                  <div className="recall">
                    <span className="label">{s.recalls.length} memories recalled</span>
                    {s.recalls.map((r, j) => (
                      <div className="recall-item" key={j}>
                        <span className="d" style={{ background: `var(--clude-${r.type})` }} />
                        <span>
                          <code style={{ fontFamily: "var(--font-mono)", color: "var(--fg-2)" }}>{r.type}</code>
                          <span style={{ marginLeft: 6 }}>{r.text}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="chat-input">
        <div className="chat-input-field">Ask anything…</div>
        <div className="chat-input-send">↑</div>
      </div>

      <aside className="chat-mem-panel">
        <div className="chat-mem-head">
          <span className="chat-mem-title">Memory · persists</span>
          <span className="chat-mem-count">128 · across models</span>
        </div>
        {MEMORY_PANEL.map((m, i) => (
          <div className="chat-mem-row" key={i}>
            <span className="d" style={{ background: `var(--clude-${m.type})` }} />
            <div>
              {m.text}
              <span className="meta">{m.meta}</span>
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}

window.ChatMockup = ChatMockup;
