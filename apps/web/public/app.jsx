// Clude Homepage — Sections (composed React components)

function NpmInstall({ size, pkg = "@clude/sdk" }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText("npm install " + pkg);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <span className={"npm " + (size === "lg" ? "npm--lg" : "")}>
      <span className="npm__cmd">
        <span className="prompt">$</span>
        <span>npm install {pkg}</span>
      </span>
      <button className={"npm__copy " + (copied ? "is-copied" : "")} onClick={copy}>
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}

function TopNav() {
  return (
    <header className="topnav">
      <div className="container topnav__inner">
        <a className="topnav__brand" href="#top">
          <img className="topnav__brand-mark" src="/logo/Clude-Icon-Blue.svg" alt="" />
          <span className="topnav__wm">CLUDE</span>
        </a>
        <div className="prodswitch">
          <button className="prodswitch__item prodswitch__item--active">Memory</button>
          <button className="prodswitch__item">Chat</button>
          <button className="prodswitch__item">SDK</button>
        </div>
        <nav className="topnav__links">
          <a className="topnav__link" href="#demo">Demo</a>
          <a className="topnav__link" href="#features">Product</a>
          <a className="topnav__link" href="#chat">Chat</a>
          <a className="topnav__link" href="#integrations">Integrations</a>
          <a className="topnav__link" href="#compare">Compare</a>
          <a className="topnav__link" href="#docs">Docs</a>
        </nav>
        <div className="topnav__right">
          <a className="topnav__link" href="#signin">Sign in</a>
          <a className="btn btn--brand" href="#install">Get started →</a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero" id="top">
      <div className="container hero__inner">
        <div className="hero__copy">
          <span className="eyebrow hero__eyebrow">
            <span className="dot"></span>
            <span>Cognitive memory · v0.4 · live on npm</span>
          </span>
          <h1 className="hero__title">
            Better memory.<br/>
            <em>Better AI.</em>
          </h1>
          <p className="hero__sub">
            Clude connects scattered context across docs, chats, and code into
            a single typed memory — so every agent you use understands what
            your team already knows.
          </p>
          <div className="hero__ctas" id="install">
            <NpmInstall size="lg" />
            <a className="btn btn--ghost btn--lg" href="#docs">Read docs ↗</a>
          </div>
          <div className="hero__signal">
            <div>
              <strong>1.96%</strong>
              HaluMem hallucination
            </div>
            <div>
              <strong>15.2%</strong>
              Next best system
            </div>
            <div>
              <strong>0.04ms</strong>
              Recall · local
            </div>
          </div>
        </div>
        <div className="hero__visual">
          <HeroDashboard />
        </div>
      </div>
    </section>
  );
}

function LiveDemoSection() {
  return (
    <section className="section" id="demo">
      <div className="container">
        <div className="section__head">
          <div>
            <span className="eyebrow eyebrow--brand">≈ LIVE DEMO</span>
            <h2 className="section__title">Watch context survive 20 compactions.</h2>
          </div>
          <p className="section__sub">
            Paste anything, or pick a sample. A regular context window degrades
            into shards. Clude's typed memory keeps the facts and entities —
            even as detail decays.
          </p>
        </div>

        <div className="demo">
          <div className="demo__input">
            <span className="eyebrow eyebrow--ink demo__label">Input content</span>
            <textarea id="demoInput" className="demo__textarea" placeholder="Paste a conversation, meeting notes, technical doc, or any text. 500+ words works best."></textarea>
            <div className="demo__presets">
              <button className="demo__preset" data-preset="conversation">Sample · conversation</button>
              <button className="demo__preset" data-preset="technical">Sample · technical doc</button>
              <button className="demo__preset" data-preset="meeting">Sample · meeting notes</button>
              <label className="demo__preset demo__upload">
                <span>↑ Upload file</span>
                <input type="file" id="demoUpload" accept=".txt,.md,.json,text/*" />
              </label>
            </div>
            <div className="demo__controls">
              <button className="btn btn--brand" id="startBtn">Start compaction →</button>
              <button className="btn btn--ghost" id="stepBtn" disabled>Compact once</button>
              <button className="btn btn--ghost" id="autoBtn" disabled>Auto (20×)</button>
              <button className="btn btn--ghost" id="resetBtn">Reset</button>
              <span className="demo__step">Step <strong id="stepNum">0</strong> / 20</span>
            </div>
          </div>

          <div className="demo__compare">
            <div className="demo__panel" id="withoutPanel">
              <div className="demo__panel-head">
                <span className="demo__panel-title">Without Clude</span>
                <span className="demo__panel-badge demo__panel-badge--red">Context window</span>
              </div>
              <div className="demo__panel-body demo__panel-body--empty" id="withoutContent">Paste content and hit Start to begin.</div>
              <div className="demo__panel-foot">
                <span>Chars · <span className="demo__metric demo__metric--red" id="withoutChars">0</span></span>
                <span>Retained · <span className="demo__metric demo__metric--red" id="withoutRetention">100%</span></span>
                <span>Facts · <span className="demo__metric demo__metric--red" id="withoutFacts">0</span></span>
                <span>Entities lost · <span className="demo__metric demo__metric--red" id="withoutEntitiesLost">0</span></span>
              </div>
            </div>
            <div className="demo__panel" id="withPanel">
              <div className="demo__panel-head">
                <span className="demo__panel-title demo__panel-title--brand">With Clude</span>
                <span className="demo__panel-badge demo__panel-badge--brand">Structured memory</span>
              </div>
              <div className="demo__panel-body demo__panel-body--empty" id="cludeContent">Paste content and hit Start to begin.</div>
              <div className="demo__entities" id="entitySection" style={{display:"none"}}></div>
              <div className="demo__panel-foot">
                <span>Memories · <span className="demo__metric demo__metric--brand" id="cludeMemories">0</span></span>
                <span>Retained · <span className="demo__metric demo__metric--brand" id="cludeRetention">100%</span></span>
                <span>Facts · <span className="demo__metric demo__metric--brand" id="cludeFacts">0</span></span>
                <span>Entities · <span className="demo__metric demo__metric--brand" id="cludeEntities">0</span></span>
              </div>
            </div>
          </div>

          <div className="demo__scores" id="scoresPanel" style={{display:"none"}}>
            <span className="eyebrow demo__scores-label">Retention score</span>
            <div className="demo__score-row">
              <span className="demo__score-label">Info retained</span>
              <span className="demo__score-track"><span className="demo__score-fill demo__score-fill--red" id="barWithout" style={{width:"100%"}}>100%</span></span>
              <span className="demo__score-track"><span className="demo__score-fill demo__score-fill--brand" id="barWith" style={{width:"100%"}}>100%</span></span>
            </div>
            <div className="demo__score-row">
              <span className="demo__score-label">Key facts</span>
              <span className="demo__score-track"><span className="demo__score-fill demo__score-fill--red" id="barFactsWithout" style={{width:"100%"}}>0</span></span>
              <span className="demo__score-track"><span className="demo__score-fill demo__score-fill--brand" id="barFactsWith" style={{width:"100%"}}>0</span></span>
            </div>
            <div className="demo__score-row">
              <span className="demo__score-label">Entities</span>
              <span className="demo__score-track"><span className="demo__score-fill demo__score-fill--red" id="barEntWithout" style={{width:"100%"}}>0</span></span>
              <span className="demo__score-track"><span className="demo__score-fill demo__score-fill--brand" id="barEntWith" style={{width:"100%"}}>0</span></span>
            </div>
            <div className="demo__scores-legend">
              <span><span className="demo__legend-dot demo__legend-dot--red"></span>Without Clude</span>
              <span><span className="demo__legend-dot demo__legend-dot--brand"></span>With Clude</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BackedBy() {
  const logos = [
    { name: "Solana", glyph: "◈" },
    { name: "MCP", glyph: "▦" },
    { name: "Stanford NLP", glyph: "◉" },
    { name: "Letta Labs", glyph: "◇" },
    { name: "Primer", glyph: "◎" },
  ];
  return (
    <section className="backed">
      <div className="container backed__inner">
        <span className="backed__label">Backed by</span>
        <div className="backed__logos">
          {logos.map(l => (
            <span className="backed__logo" key={l.name}>
              <span style={{fontSize:18, color:"var(--fg-1)"}}>{l.glyph}</span>
              <span>{l.name}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    id: "recall",
    num: "01",
    tab: "Recall",
    eyebrow: "RECALL",
    title: "We find scattered context, together.",
    desc: "Stop pasting the same context into ChatGPT, Claude, and Cursor. Clude's hybrid recall connects context across documents, conversations, and code in a single query.",
    meta: "Hybrid match · keyword + semantic + relation + recency",
    Art: () => <RecallScreen />,
  },
  {
    id: "answer",
    num: "02",
    tab: "Answer",
    eyebrow: "ANSWER",
    title: "Answers always come with sources.",
    desc: "Every answer cites the memories it came from — the meeting, the ticket, the runbook. Trust isn't a vibe; it's a footnote.",
    meta: "Cited · 3 sources · on-chain proof",
    Art: () => <AnswerScreen />,
  },
  {
    id: "save",
    num: "03",
    tab: "Save",
    eyebrow: "STORE",
    title: "Recurring decisions live in team memory.",
    desc: "Explanations and decisions you'll need again get typed, dated, and stored. Importance and decay keep them ranked over time — not lost in a thread.",
    meta: "Stored · semantic · imp 0.84",
    Art: () => <SaveScreen />,
  },
  {
    id: "handoff",
    num: "04",
    tab: "Handoff",
    eyebrow: "PORTABLE",
    title: "The next person — and the next AI — pick up where you left off.",
    desc: "Memory packs are portable. Export from one agent, import into another. People change, tools change; the context survives.",
    meta: "Memory pack · 412 memories · clude-research",
    Art: () => <HandoffScreen />,
  },
];

function FeatureSection() {
  const [active, setActive] = useState("recall");
  function scrollTo(id) {
    setActive(id);
    const el = document.getElementById("feat-" + id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 130;
      window.scrollTo({ top, behavior: "smooth" });
    }
  }
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section__head">
          <div>
            <span className="eyebrow eyebrow--brand">≈ Brings every context together</span>
            <h2 className="section__title">Four ways Clude shows up in your workflow.</h2>
          </div>
          <p className="section__sub">
            One memory layer, four touchpoints. Each backed by the same typed,
            decaying, cite-able store.
          </p>
        </div>

        <div className="featuretabs">
          {FEATURES.map(f => (
            <button
              key={f.id}
              className={"featuretab " + (active === f.id ? "featuretab--active" : "")}
              onClick={() => scrollTo(f.id)}
            >
              <span className="featuretab__num">{f.num}</span>
              <span>{f.tab}</span>
            </button>
          ))}
        </div>

        <div className="featurecards">
          {FEATURES.map(f => (
            <article className={"featurecard featurecard--" + f.id} id={"feat-" + f.id} key={f.id}>
              <div className="featurecard__copy">
                <div className="featurecard__copy-top">
                  <span className="eyebrow">{f.num} · {f.eyebrow}</span>
                  <h3 className="featurecard__title">{f.title}</h3>
                  <p className="featurecard__desc">{f.desc}</p>
                </div>
                <div className="featurecard__meta">
                  <span className="dot"></span>
                  <span className="featurecard__metalabel">{f.meta}</span>
                </div>
              </div>
              <div className="featurecard__art">
                <div className="featurecard__atmos" aria-hidden="true">
                  <span className="featurecard__atmos-blur featurecard__atmos-blur--a"></span>
                  <span className="featurecard__atmos-blur featurecard__atmos-blur--b"></span>
                  <span className="featurecard__atmos-blur featurecard__atmos-blur--c"></span>
                  <span className="featurecard__atmos-grain"></span>
                </div>
                <div className="featurecard__artinner">
                  <f.Art />
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function ChatProductSection() {
  return (
    <section className="section" id="chat">
      <div className="container">
        <div className="section__head">
          <div>
            <span className="eyebrow eyebrow--brand">CLUDE CHAT · NEW</span>
            <h2 className="section__title">One chat. Every model. All your memory.</h2>
          </div>
          <p className="section__sub">
            A chat app for the rest of us — plug in Claude, GPT, Gemini,
            Llama, Mistral, or any local model. Clude memory is shared across
            every conversation.
          </p>
        </div>

        <div className="bigfeature">
          <div className="bigfeature__copy">
            <span className="eyebrow">CHAT · MULTI-MODEL</span>
            <h3 className="bigfeature__title">Frontier and open source — same memory underneath.</h3>
            <p className="bigfeature__desc">
              Switch models mid-thread. Bring your own API keys, use our hosted
              proxy, or run open source models locally. Whatever you pick, the
              context comes with it — Clude memory threads through every
              response, with cited sources from your real work.
            </p>
            <div style={{display:"flex", flexDirection:"column", gap:10, marginTop:8}}>
              <div style={{display:"flex", alignItems:"center", gap:10, fontFamily:"var(--font-mono)", fontSize:11, color:"var(--fg-2)", letterSpacing:"0.04em"}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:"var(--brand)"}}></span>
                12 models · Anthropic · OpenAI · Google · Meta · Mistral · DeepSeek · Qwen
              </div>
              <div style={{display:"flex", alignItems:"center", gap:10, fontFamily:"var(--font-mono)", fontSize:11, color:"var(--fg-2)", letterSpacing:"0.04em"}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:"var(--clude-success)"}}></span>
                BYO keys · or hosted · or fully local via Ollama
              </div>
              <div style={{display:"flex", alignItems:"center", gap:10, fontFamily:"var(--font-mono)", fontSize:11, color:"var(--fg-2)", letterSpacing:"0.04em"}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:"var(--clude-procedural)"}}></span>
                Memory shared across threads · cite-able answers
              </div>
            </div>
            <div style={{marginTop:18, display:"flex", gap:10, flexWrap:"wrap", alignItems:"center"}}>
              <a className="btn btn--brand" href="#chat-app">Open Clude Chat ↗</a>
              <a className="btn btn--ghost" href="#ios">iOS · Android · Web</a>
            </div>
          </div>
          <div className="bigfeature__art" style={{padding:"36px 28px", overflow:"visible"}}>
            <ChatScreen />
          </div>
        </div>
      </div>
    </section>
  );
}

function ProblemsSection() {
  const problems = [
    { num:"01", title:"When wording changes the AI's answer", desc:"Small phrasing shifts shouldn't reshape what the model knows. Memory normalizes across queries." },
    { num:"02", title:"When you keep re-explaining background", desc:"Criteria, constraints, and decisions stay typed and dated — never re-pasted into a prompt." },
    { num:"03", title:"When every agent needs context again", desc:"ChatGPT, Claude, Cursor — all read from the same memory. No more parallel briefings." },
    { num:"04", title:"When you need to trace a decision", desc:"Docs alone aren't enough. Chats and commits matter too. Clude bonds them across types." },
    { num:"05", title:"When useful answers get buried", desc:"A good answer becomes a memory, not a thread you'll search for in three weeks." },
    { num:"06", title:"When new teammates need to ramp", desc:"Hand them a memory pack. Decisions, runbooks, and context — already typed." },
  ];
  return (
    <section className="section" id="problems">
      <div className="container">
        <div className="section__head">
          <div>
            <span className="eyebrow">PROBLEM SPACE</span>
            <h2 className="section__title">Six failure modes Clude is built to fix.</h2>
          </div>
          <p className="section__sub">
            Memory isn't a feature on top of LLMs — it's the missing layer
            underneath them.
          </p>
        </div>
        <div className="problems">
          {problems.map(p => (
            <div className="problem" key={p.num}>
              <span className="problem__num">{p.num}</span>
              <h3 className="problem__title">{p.title}</h3>
              <p className="problem__desc">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function IntegrationsSection() {
  const sources = [
    "Gmail","Drive","Calendar","Outlook",
    "Slack","Notion","Linear","GitHub",
    "Figma","Intercom","Zendesk","Web",
  ];
  const agents = [
    "ChatGPT","Claude","Cursor","Gemini",
    "Claude Code","Perplexity","VS Code","MCP",
  ];
  function Cell({ name }) {
    const initial = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
    return (
      <div className="integration-cell">
        <span className="integration-cell__icon">{initial}</span>
        <span className="integration-cell__name">{name}</span>
      </div>
    );
  }
  return (
    <section className="section" id="integrations">
      <div className="container">
        <div className="section__head">
          <div>
            <span className="eyebrow">INTEGRATIONS</span>
            <h2 className="section__title">Connects the tools you already use.</h2>
          </div>
          <p className="section__sub">
            Sources flow in, agents read out. Need something missing?{" "}
            <a className="cl-link" style={{color:"var(--brand)"}} href="#request">Request integration ↗</a>
          </p>
        </div>
        <div className="integrations">
          <div className="integration-block">
            <div className="integration-block__head">
              <span className="integration-block__name">Sources · Inbound</span>
              <span className="integration-block__count">12 connectors · more weekly</span>
            </div>
            <div className="integration-grid">
              {sources.map(n => <Cell key={n} name={n} />)}
            </div>
          </div>
          <div className="integration-block">
            <div className="integration-block__head">
              <span className="integration-block__name">Agents · Outbound</span>
              <span className="integration-block__count">via MCP · zero config</span>
            </div>
            <div className="integration-grid">
              {agents.map(n => <Cell key={n} name={n} />)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CompareSection() {
  const rows = [
    { label: "Brief", a: "Easy internal info search", b: "Devs add memory APIs to apps", c: "Helps the AI you use remember your team's context" },
    { label: "Data range", a: "Internal docs only", b: "User memory inside one app", c: "Documents, code, email, messengers, and existing AI chats" },
    { label: "Search mode", a: "Document similarity (RAG)", b: "Stored memory similarity", c: "Hybrid — keyword + semantic + relation + recency, with decay" },
    { label: "AI integration", a: "—", b: "—", c: "ChatGPT, Claude, Cursor, MCP — out of the box" },
    { label: "Workflow capture", a: "—", b: "—", c: "Tacit knowledge → reusable runbooks (skill packs)" },
    { label: "Setup", a: "Org docs → upload → use", b: "Custom development required", c: "Connect → upload → use" },
  ];
  return (
    <section className="section" id="compare">
      <div className="container">
        <div className="section__head">
          <div>
            <span className="eyebrow">COMPARE</span>
            <h2 className="section__title">Why Clude is different.</h2>
          </div>
          <p className="section__sub">
            Internal-search tools answer queries. Memory APIs hand devs primitives.
            Clude is the cognitive layer agents read from.
          </p>
        </div>
        <div className="compare">
          <div className="compare__row compare__row--head">
            <div className="compare__cell compare__cell--label">Capability</div>
            <div className="compare__cell"><span className="compare__head">Internal Search · RAG</span></div>
            <div className="compare__cell"><span className="compare__head">Memory APIs · Letta · MemGPT</span></div>
            <div className="compare__cell compare__cell--featured"><span className="compare__head compare__head--brand">Clude</span></div>
          </div>
          {rows.map(r => (
            <div className="compare__row" key={r.label}>
              <div className="compare__cell compare__cell--label">{r.label}</div>
              <div className="compare__cell">{r.a === "—" ? <span className="compare__dash">—</span> : r.a}</div>
              <div className="compare__cell">{r.b === "—" ? <span className="compare__dash">—</span> : r.b}</div>
              <div className="compare__cell compare__cell--featured">{r.c}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DecaySection() {
  return (
    <section className="section" id="decay">
      <div className="container">
        <div className="bigfeature">
          <div className="bigfeature__copy">
            <span className="eyebrow eyebrow--brand">DIFFERENTIAL DECAY</span>
            <h2 className="bigfeature__title">Memories that get clearer over time.</h2>
            <p className="bigfeature__desc">
              Not all information is stored the same. Frequently used and
              important memories stay clearer; older or contradicted information
              is deprioritized — so the AI uses more accurate context, not just
              more context.
            </p>
            <p className="bigfeature__desc" style={{color:"var(--fg-3)", fontSize:12, fontFamily:"var(--font-mono)", letterSpacing:"0.04em"}}>
              episodic 7%/day · semantic 2%/day · procedural 3%/day · self-model 1%/day
            </p>
          </div>
          <div className="bigfeature__art">
            <DecayMini />
          </div>
        </div>
      </div>
    </section>
  );
}

function HybridSection() {
  return (
    <section className="section" id="hybrid">
      <div className="container">
        <div className="bigfeature bigfeature--reverse">
          <div className="bigfeature__art">
            <HybridScreen />
          </div>
          <div className="bigfeature__copy">
            <span className="eyebrow eyebrow--brand">HYBRID RECALL ENGINE</span>
            <h2 className="bigfeature__title">Beyond similarity. It finds context like memory.</h2>
            <p className="bigfeature__desc">
              Vector search alone misses the point. Clude's engine combines
              keywords, meaning, relationships, and timing — modeled after how
              human memory actually retrieves — to find the conversations,
              documents, and decisions you need.
            </p>
            <p className="bigfeature__desc" style={{color:"var(--fg-3)", fontSize:12, fontFamily:"var(--font-mono)", letterSpacing:"0.04em"}}>
              local-first · SQLite + WAL · 0.04ms p50 · zero network
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="cta">
      <div className="container cta__inner">
        <span className="cta__eyebrow">≈ NPM · LIVE NOW</span>
        <h2 className="cta__title">Smart context starts with smarter memory.</h2>
        <p className="cta__sub">
          Open source. No API keys required, no network dependency,
          full semantic search offline. One install, every agent.
        </p>
        <div style={{margin:"6px 0 4px"}}>
          <NpmInstall size="lg" />
        </div>
        <div className="cta__ctas">
          <a className="btn btn--primary btn--lg" href="#docs">Read the SDK docs →</a>
          <a className="btn btn--ghost btn--lg" href="#chat-app">Open Clude Chat</a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__inner">
          <div className="footer__brand">
            <div className="topnav__brand">
              <img className="topnav__brand-mark" src="/logo/Clude-Icon-Blue.svg" alt="" />
              <span className="topnav__wm">CLUDE</span>
            </div>
            <p className="footer__tag">
              Cognitive memory for AI agents. Not a service you depend on —
              infrastructure you own.
            </p>
          </div>
          <div className="footer__col">
            <h4>Product</h4>
            <ul>
              <li><a href="#">SDK</a></li>
              <li><a href="#">Dashboard</a></li>
              <li><a href="#">MCP server</a></li>
              <li><a href="#">Memory packs</a></li>
            </ul>
          </div>
          <div className="footer__col">
            <h4>Resources</h4>
            <ul>
              <li><a href="#">Docs</a></li>
              <li><a href="#">HaluMem benchmark</a></li>
              <li><a href="#">Blog</a></li>
              <li><a href="#">GitHub ↗</a></li>
            </ul>
          </div>
          <div className="footer__col">
            <h4>Company</h4>
            <ul>
              <li><a href="#">About</a></li>
              <li><a href="#">Contact</a></li>
              <li><a href="#">X / @Cludebot</a></li>
              <li><a href="#">LinkedIn</a></li>
            </ul>
          </div>
        </div>
        <div className="footer__bot">
          <span>© 2026 Clude · Cognitive memory infrastructure</span>
          <div className="footer__bot-right">
            <span>Privacy</span>
            <span>Terms</span>
            <span>v0.4.2</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function App() {
  return (
    <div className="page">
      <TopNav />
      <Hero />
      <BackedBy />
      <LiveDemoSection />
      <FeatureSection />
      <ChatProductSection />
      <ProblemsSection />
      <IntegrationsSection />
      <CompareSection />
      <DecaySection />
      <HybridSection />
      <CTASection />
      <Footer />
    </div>
  );
}

const { useState, useEffect, useMemo } = React;

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
