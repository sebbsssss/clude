/* global React */
// app-linear.jsx — Clude rebuilt in Linear's dark, monotone aesthetic.
// Ported from the Claude Design handoff. Ships light of the design-tool tweaks
// panel; accent hardcoded to Clude blue. Motion layer in motion.js (initMotion).
const { useEffect } = React;

// ────────────────────────────────────────────────────────────────────────────
// LOGO — Clude icon, inlined so it inherits currentColor on dark surfaces
// ────────────────────────────────────────────────────────────────────────────
function CludeMark({ className }) {
  return (
    <svg className={className} viewBox="0 0 1080 1080" fill="currentColor" aria-hidden="true">
      <path d="M877.5,295.97V109.03c0-10.51-8.52-19.03-19.03-19.03h-430.97c-10.51,0-19.03,8.52-19.03,19.03v147.53c0,25.23-10.02,49.44-27.87,67.28l-155.81,155.81c-14.28,14.27-22.29,33.64-22.29,53.82v437.5c0,10.51,8.52,19.03,19.03,19.03h636.94c10.51,0,19.03-8.52,19.03-19.03v-186.94c0-10.51-8.52-19.03-19.03-19.03h-421.46c-5.25,0-9.51-4.26-9.51-9.51v-402.43c0-21.02,17.04-38.06,38.06-38.06h392.91c10.51,0,19.03-8.52,19.03-19.03Z" />
    </svg>);
}

// ────────────────────────────────────────────────────────────────────────────
// NAV
// ────────────────────────────────────────────────────────────────────────────
function Nav() {
  return (
    <nav className="nav">
      <div className="container">
        <div className="nav-inner">
          <div className="nav-left">
            <a href="#" className="nav-brand">
              <CludeMark className="nav-brand-mark" />
              <span className="nav-brand-word">Clude</span>
            </a>
            <div className="nav-links">
              <a href="#hallucination" className="nav-link">Accuracy</a>
              <a href="#compaction" className="nav-link">Compaction</a>
              <a href="#scale" className="nav-link">Scale</a>
              <a href="#how" className="nav-link">How it works</a>
              <a href="#compare" className="nav-link">Compare</a>
            </div>
          </div>
          <div className="nav-right">
            <a href="https://github.com/sebbsssss/clude" className="nav-link">GitHub ↗</a>
            <a href="#get-started" className="btn btn-primary">Install <span className="arr">→</span></a>
          </div>
        </div>
      </div>
    </nav>);
}

// ────────────────────────────────────────────────────────────────────────────
// HERO
// ────────────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="hero">
      <div className="container">
        <div className="hero-content">
          <div className="eyebrow-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="eyebrow-pill brand"><span className="dot" />v0.9 · Open source · MIT</span>
            <span className="eyebrow-pill">Built for developers</span>
          </div>
          <h1 className="hero-title">
            The memory layer for<br />developers who push<br /><span className="quiet">models hardest.</span>
          </h1>
          <p className="hero-lede">
            Grounded, verifiable memory for AI agents. Your agent remembers your codebase, decisions and taste, and answers only from what it actually knows.
          </p>
          <div className="hero-cta">
            <a href="#get-started" className="btn btn-primary btn-lg">Install @clude/sdk <span className="arr">→</span></a>
            <a href="#how" className="btn btn-ghost btn-lg">See how it works</a>
          </div>
          <div className="hero-meta"><b>2% hallucination rate.</b> Grounded or abstain. Never fabricate. Open source, local-first.</div>
        </div>
        <div className="hero-mockup">
          <ChatMockup />
        </div>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// TRUSTED — compatibility, not customers
// ────────────────────────────────────────────────────────────────────────────
function Trusted() {
  const logos = ["CLAUDE", "CURSOR", "OPENAI", "VERCEL AI", "LANGCHAIN", "MCP"];
  return (
    <section className="trusted">
      <div className="container">
        <div className="trusted-label">Plugs into the agents developers already build with</div>
        <div className="trusted-row">
          {logos.map((l) => <span className="trusted-logo" key={l}>{l}</span>)}
        </div>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// HALLUCINATION BAND — 2%, front & centre
// ────────────────────────────────────────────────────────────────────────────
function HallucinationBand() {
  const steps = [
  { n: "01", h: "Ingest", p: "Facts are written into Clude's memory once, each typed, embedded, and verifiable. Nothing is invented at answer time." },
  { n: "02", h: "Recall", p: "At question time, hybrid vector + keyword recall surfaces only the few memories that actually answer the question." },
  { n: "03", h: "Ground", p: "The model answers from what it found, or says “I don't know” when recall comes back empty. It never guesses." }];
  return (
    <section className="halluc" id="hallucination">
      <div className="container">
        <div className="eyebrow-row"><span className="eyebrow-pill brand"><span className="dot" />Trust the output</span></div>
        <div className="halluc-cap">Hallucination rate · HaluMem benchmark</div>
        <div className="halluc-figure"><span className="halluc-num" data-count data-to="2" data-dec="0" data-display="2">2</span><span className="pct">%</span></div>
        <h2 className="halluc-h">Grounded or abstain. <em>Never fabricate.</em></h2>
        <p className="halluc-sub">
          Clude answers from verified memory, or says "I don't know." No guessing, no confident wrong answers. The lowest hallucination rate of any open memory system, by 7.8×.
        </p>
        <div className="halluc-steps">
          {steps.map((s) =>
          <div className="halluc-step" key={s.n}>
              <div className="n">STEP {s.n}</div>
              <h4 className="halluc-step-h">{s.h}</h4>
              <p className="halluc-step-p">{s.p}</p>
            </div>)}
        </div>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// SCALE PROOF — 2M Solana facts · single-hop · Clude vs frontier model
// ────────────────────────────────────────────────────────────────────────────
function ScaleProof() {
  const headline = [
  { to: 2000000, comma: true, num: "2,000,000", lab: "on-chain data facts loaded into local memory (142M token size)" },
  { to: 100, suf: "%", num: "100%", lab: "retrieval accuracy · every fact found in the top 8 · 0 misses" },
  { num: "0", lab: "hallucinations · every answer grounded in the retrieved fact" }];
  const cludeRows = [
  { k: "Input tokens / query", v: "~199" },
  { k: "Time to find the fact", v: "0.33 ms" },
  { k: "Hallucinations", v: "0" }];
  const modelRows = [
  { k: "Input tokens / query", v: "~177,330" },
  { k: "Share of corpus it can see", v: "0.14%" },
  { k: "Abstains on every question", v: "100%" }];
  return (
    <section className="scale" id="scale">
      <div className="container">
        <div className="section-head">
          <div className="eyebrow-row"><span className="eyebrow-pill">Proven at scale</span></div>
          <h2 className="section-title">Two million facts. <span className="quiet">One exact answer.</span></h2>
          <p className="section-lede">
            We loaded two million real Solana mainnet records into Clude, then asked for a single fact buried anywhere in the pile. Clude finds the exact one every time, with single-hop recall. The same frontier model, handed the largest slice that fits in its context window, cannot. The data simply does not fit.
          </p>
        </div>
        <div className="scale-stats">
          {headline.map((s, i) =>
          <div className="scale-stat" key={i}>
              <div className="scale-stat-num"
            {...s.to ? { "data-count": true, "data-to": s.to, "data-suf": s.suf || "", "data-comma": s.comma || undefined, "data-display": s.num } : {}}>{s.num}</div>
              <div className="scale-stat-lab">{s.lab}</div>
            </div>)}
        </div>
        <div className="scale-versus">
          <div className="vs-card win">
            <div className="vs-head">
              <span className="vs-mark win">✓</span>
              <div><div className="vs-title">Clude</div><div className="vs-meta">retrieves the one fact it needs</div></div>
            </div>
            <div className="vs-big">100<span className="u">%</span></div>
            <div className="vs-big-lab">answered correctly</div>
            <div className="vs-rows">{cludeRows.map((r, i) => <div className="vs-row" key={i}><span>{r.k}</span><b>{r.v}</b></div>)}</div>
            <p className="vs-note">Reads only the one fact it needs, from all 2,000,000. Cost and accuracy stay flat no matter how large the pile grows.</p>
          </div>
          <div className="vs-card lose">
            <div className="vs-head">
              <span className="vs-mark lose">✕</span>
              <div><div className="vs-title">Same model</div><div className="vs-meta">given a full context window of data</div></div>
            </div>
            <div className="vs-big muted">0<span className="u">%</span></div>
            <div className="vs-big-lab">answered correctly</div>
            <div className="vs-rows">{modelRows.map((r, i) => <div className="vs-row" key={i}><span>{r.k}</span><b>{r.v}</b></div>)}</div>
            <p className="vs-note">A single prompt can hold ~2,500 facts. It cannot fit 99.86% of the data, so on a random query it effectively never can.</p>
          </div>
        </div>
        <div className="scale-verdict">
          <div className="scale-verdict-num" data-count data-to="891" data-suf="×" data-display="891×">891×</div>
          <div className="scale-verdict-txt">
            <b>fewer input tokens per query, and more accurate.</b> ~199 tokens with Clude versus ~177,330 reading a full context window. Higher accuracy, a fraction of the cost.
          </div>
        </div>
        <p className="scale-foot">
          Same model in both columns (Claude Haiku 4.5). Answers graded by deterministic exact match, not an LLM judge, and independently re-checked with GPT-5.5, a model from a different vendor: <b>98% correct</b> from Clude's retrieved facts, <b>0%</b> without, zero fabrications. The gap is not honesty. It's that brute-force context cannot hold the data.
        </p>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// PROBLEM
// ────────────────────────────────────────────────────────────────────────────
function Problem() {
  return (
    <section className="problem">
      <div className="container">
        <p className="problem-quote">
          "I was sick of <span className="strike">explaining myself</span> to my agent every session. Pasting the same context. Re-stating the same preferences. Watching it forget what we decided last week."
        </p>
        <span className="problem-attribution">Every developer who's ever used an LLM</span>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// INSIGHT
// ────────────────────────────────────────────────────────────────────────────
function Insight() {
  return (
    <section className="insight">
      <div className="container">
        <div className="eyebrow-row"><span className="eyebrow-pill">The insight</span></div>
        <h2 className="insight-text">Memory isn't a vector store.<br />It's <em>synthesis</em>.</h2>
        <p className="insight-sub">
          Storage is solved. What agents are missing is the layer above it: typed decay, consolidation, contradiction resolution, reflection. The work memory does when no-one's looking.
        </p>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// USE CASES
// ────────────────────────────────────────────────────────────────────────────
function UseCases() {
  const cases = [
  { tag: "Coding agent", tagColor: "var(--clude-semantic)", h: "Remembers your codebase, not just your last 8k tokens.", p: "Your conventions, your stack, the bugs you've already chased, the patterns you've already rejected. The agent stops re-discovering what it learned last sprint.", q: "Why is the auth flow split across two services?", a: "Recalled · we discussed this on May 4th. Kept legacy /v1/auth for the iOS app until v2.3 ships. (episodic, imp 0.86)" },
  { tag: "Support agent", tagColor: "var(--clude-episodic)", h: "Remembers every customer the way a great rep would.", p: "Past tickets, preferences, what's been promised, what's still open. The agent walks in already knowing the relationship. No swivel to the CRM, no copy-paste briefing.", q: "Hey, following up on the export issue from last month.", a: "Recalled · ticket #4821 · CSV>50MB times out on EU region · workaround given · awaiting hotfix v4.2. (episodic, imp 0.91)" },
  { tag: "Research agent", tagColor: "var(--clude-procedural)", h: "Remembers what didn't work, so it stops trying it again.", p: "Hypotheses tested, papers read, dead ends ruled out. Clinamen biases lateral recall toward adjacent-but-unexpected: the useful swerve, not just the obvious match.", q: "What benchmarks should I run for the new architecture?", a: "Recalled · you ruled out HaluMem-v1 (Apr 12) and MMLU (Apr 18, too coarse). Suggesting LongBench + custom recall eval. (procedural, imp 0.78)" }];
  return (
    <section className="section" id="use-cases">
      <div className="container">
        <div className="section-head">
          <div className="eyebrow-row"><span className="eyebrow-pill">For every kind of agent</span></div>
          <h2 className="section-title">Same memory engine. <span className="quiet">Every kind of agent.</span></h2>
          <p className="section-lede">Clude isn't built for one vertical. It's a substrate. Whatever your agent does, it does better when it remembers.</p>
        </div>
        <div className="usecases">
          {cases.map((c, i) =>
          <div className="usecase" key={i}>
              <div className="usecase-tag"><span className="d" style={{ background: c.tagColor }} />{c.tag}</div>
              <h3 className="usecase-h">{c.h}</h3>
              <p className="usecase-p">{c.p}</p>
              <div className="usecase-scenario">
                <div className="usecase-q">{c.q}</div>
                <div className="usecase-a"><span className="recalled">↺ </span>{c.a}</div>
              </div>
            </div>)}
        </div>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// HOW IT WORKS
// ────────────────────────────────────────────────────────────────────────────
function HowItWorks() {
  return (
    <section className="section" id="how">
      <div className="container">
        <div className="section-head">
          <div className="eyebrow-row"><span className="eyebrow-pill">How it works</span></div>
          <h2 className="section-title">Three primitives. <span className="quiet">That's it.</span></h2>
          <p className="section-lede">Store, decay, recall, with the right work happening between calls. Five lines of code in, real memory out.</p>
        </div>
        <div className="how-grid">
          <div className="how-card">
            <div className="how-card-illus">
              <div className="illus-decay"><div className="bar" /><div className="bar" /><div className="bar" /><div className="bar" /><div className="bar" /></div>
            </div>
            <div className="how-card-n">STEP 01</div>
            <h3 className="how-card-h">Typed memory, differential decay.</h3>
            <p className="how-card-p">Every memory has a kind: episodic, semantic, procedural, self-model. Each decays at its own rate. What matters stays. What doesn't, fades.</p>
          </div>
          <div className="how-card">
            <div className="how-card-illus">
              <svg className="illus-synth" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid meet">
                <g stroke="var(--brand-bright)" strokeWidth="1" fill="none" opacity="0.6">
                  <line x1="40" y1="30" x2="100" y2="60" /><line x1="40" y1="60" x2="100" y2="60" /><line x1="40" y1="90" x2="100" y2="60" /><line x1="100" y1="60" x2="160" y2="60" />
                </g>
                <circle cx="40" cy="30" r="6" fill="var(--clude-episodic)" /><circle cx="40" cy="60" r="6" fill="var(--clude-episodic)" /><circle cx="40" cy="90" r="6" fill="var(--clude-episodic)" />
                <circle cx="100" cy="60" r="9" fill="var(--brand-bright)" /><circle cx="160" cy="60" r="11" fill="var(--clude-semantic)" />
                <text x="100" y="104" textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8" fill="var(--fg-3)" letterSpacing="0.04em">dream.run()</text>
              </svg>
            </div>
            <div className="how-card-n">STEP 02</div>
            <h3 className="how-card-h">Dream cycles consolidate.</h3>
            <p className="how-card-p">Between tasks, Clude runs background passes: clustering related episodes into semantic knowledge, resolving contradictions, surfacing introspective summaries.</p>
          </div>
          <div className="how-card">
            <div className="how-card-illus">
              <div className="illus-recall">
                <span className="recall-pill">user prefs</span><span className="recall-pill hit">dense ui</span><span className="recall-pill">react 19</span><span className="recall-pill hit">inter</span><span className="recall-pill">dark bg</span><span className="recall-pill hit">monotone</span><span className="recall-pill">…</span>
              </div>
            </div>
            <div className="how-card-n">STEP 03</div>
            <h3 className="how-card-h">Recall, with clinamen.</h3>
            <p className="how-card-p">Exact-match retrieval misses the point. Clinamen biases recall toward adjacent-but-unexpected memories: the half-forgotten useful swerve, not just the obvious hit.</p>
          </div>
        </div>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// COMPARE
// ────────────────────────────────────────────────────────────────────────────
function Compare() {
  const rows = [
  { feature: "Persists between sessions", clude: "y", vec: "y", ctx: "n", chat: "p" },
  { feature: "Typed memory (episodic/semantic/…)", clude: "y", vec: "n", ctx: "n", chat: "n" },
  { feature: "Differential decay", clude: "y", vec: "n", ctx: "n", chat: "n" },
  { feature: "Consolidation / dream cycles", clude: "y", vec: "n", ctx: "n", chat: "n" },
  { feature: "Contradiction resolution", clude: "y", vec: "n", ctx: "n", chat: "n" },
  { feature: "Lateral recall (clinamen)", clude: "y", vec: "p", ctx: "n", chat: "n" },
  { feature: "Local-first, no API key", clude: "y", vec: "p", ctx: "y", chat: "n" },
  { feature: "Portable across agent hosts", clude: "y", vec: "n", ctx: "n", chat: "n" },
  { feature: "Open source · MIT", clude: "y", vec: "p", ctx: "n", chat: "n" }];
  const icon = (v) => v === "y" ? <span className="compare-icon y">✓</span> : v === "p" ? <span className="compare-icon p">~</span> : <span className="compare-icon n">·</span>;
  return (
    <section className="section" id="compare">
      <div className="container">
        <div className="section-head">
          <div className="eyebrow-row"><span className="eyebrow-pill">vs.</span></div>
          <h2 className="section-title">Not just a vector DB <span className="quiet">with marketing.</span></h2>
          <p className="section-lede">The honest comparison. Vector DBs are great at storage; context windows are great until they overflow; chatbot memory is a saved-string feature. Clude does the work in between.</p>
        </div>
        <div className="compare-wrap">
          <div className="compare-row head">
            <div className="feature">Capability</div><div className="col-clude">Clude</div><div>Vector DB</div><div>Context window</div><div>Chatbot memory</div>
          </div>
          {rows.map((r, i) =>
          <div className="compare-row" key={i}>
              <div className="feature">{r.feature}</div>
              <div className="col-clude">{icon(r.clude)}</div>
              <div className="compare-cell">{icon(r.vec)}</div>
              <div className="compare-cell">{icon(r.ctx)}</div>
              <div className="compare-cell">{icon(r.chat)}</div>
            </div>)}
        </div>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// STATS BAND
// ────────────────────────────────────────────────────────────────────────────
function StatsBand() {
  return (
    <section className="stats-band">
      <div className="container">
        <div className="eyebrow-row"><span className="eyebrow-pill">By the numbers</span></div>
        <h2 className="section-title">Smarter agents. Less re-explaining.</h2>
        <p className="section-lede">Built on open research. Measured on open benchmarks. The numbers we actually publish.</p>
        <div className="stats-grid">
          <div className="stat-block"><div className="stat-num">~82<span className="small">%</span></div><div className="stat-meta"><b>Fewer tokens per session.</b> Memory recalls ~6 facts instead of re-reading the whole transcript every turn.</div></div>
          <div className="stat-block"><div className="stat-num">8×</div><div className="stat-meta"><b>Better multi-turn recall</b> than the next leading SDK on factual consistency.</div></div>
          <div className="stat-block"><div className="stat-num">~60s</div><div className="stat-meta"><b>From npm install to first stored memory.</b> One command, zero config, no API key.</div></div>
          <div className="stat-block"><div className="stat-num">100<span className="small">%</span></div><div className="stat-meta"><b>Local-first.</b> Runs offline. Embeddings on-device. Your memories never leave your machine.</div></div>
        </div>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// TESTIMONIALS (illustrative placeholders — see disclaimer below)
// ────────────────────────────────────────────────────────────────────────────
function Testimonials() {
  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <div className="eyebrow-row"><span className="eyebrow-pill">From the field</span></div>
          <h2 className="section-title">What developers say <span className="quiet">about agents with memory.</span></h2>
        </div>
        <div className="testimonials">
          <div className="testimonial feature">
            <p className="testimonial-quote">The shift isn't bigger context windows. It's memory that <em>compounds</em>. The agent gets sharper every week. After three months on Clude, I stopped re-briefing it.</p>
            <div className="testimonial-meta"><div className="testimonial-avatar">MR</div><div><div className="testimonial-who">M. Reyes</div><div className="testimonial-role">Staff Engineer · agent infra</div></div></div>
          </div>
          <div className="testimonial">
            <p className="testimonial-quote">Replaced our home-grown "memory" (read: a JSON blob with hand-written eviction). Clude was running locally in under a minute. The dream-cycle consolidation was the unlock.</p>
            <div className="testimonial-meta"><div className="testimonial-avatar">JT</div><div><div className="testimonial-who">J. Tanaka</div><div className="testimonial-role">CTO · YC-backed agent startup</div></div></div>
          </div>
          <div className="testimonial">
            <p className="testimonial-quote">I tried Mem0, MemGPT, LangChain memory, and a few homegrown things. Clude is the first one that felt like an actual memory engine, not retrieval theatre.</p>
            <div className="testimonial-meta"><div className="testimonial-avatar">AK</div><div><div className="testimonial-who">A. Kowalski</div><div className="testimonial-role">Independent researcher</div></div></div>
          </div>
        </div>
        <p style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-4)", marginTop: 32, letterSpacing: "0.04em" }}>Testimonials shown are illustrative placeholders.</p>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// FOUNDER — left-aligned, editorial
// ────────────────────────────────────────────────────────────────────────────
function Founder() {
  const creds = ["10+ years in AI", "ex-ByteDance", "DBS", "ByteDance Security", "Seed program"];
  return (
    <section className="founder" id="founder">
      <div className="container">
        <div className="founder-top">
          <span className="founder-idx">Who's building this</span>
          <span className="founder-rule" />
        </div>
        <div className="founder-grid">
          <div className="founder-aside">
            <div className="founder-mono"><CludeMark className="founder-mono-mark" /></div>
            <h2 className="founder-name">Sebastien</h2>
            <div className="founder-role">Founder · Clude</div>
          </div>
          <div className="founder-main">
            <p className="founder-lead">
              More than a decade building AI systems. Previously at ByteDance, across DBS, ByteDance Security, and the Seed program, shipping intelligence and infrastructure at planetary scale.
            </p>
            <p className="founder-bio">
              Clude is the memory layer he wished those systems had: grounded, verifiable, and built for the developers who push models hardest.
            </p>
            <div className="founder-creds">{creds.map((c) => <span className="founder-cred" key={c}>{c}</span>)}</div>
          </div>
        </div>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// TRUST
// ────────────────────────────────────────────────────────────────────────────
function Trust() {
  const cards = [
  { icon: "◐", h: "Local-first", p: "SQLite + on-device embeddings. Zero API keys, zero network, full semantic search offline." },
  { icon: "◇", h: "Open source · MIT", p: "Every line of the engine on GitHub. Audit it, fork it, run it in air-gapped environments." },
  { icon: "▤", h: "Portable memory", p: "Signed memory packets move between agents. Your memories aren't trapped in one vendor." },
  { icon: "◈", h: "No training on your data", p: "We don't train on your memories. Cloud is opt-in. Inspect, export, or wipe any time." }];
  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <div className="eyebrow-row"><span className="eyebrow-pill">Trust by design</span></div>
          <h2 className="section-title">Your memories. Your machine. <span className="quiet">Your call.</span></h2>
          <p className="section-lede">Clude is local-first by default. The cloud option exists; you don't have to use it. Either way, you can read every byte of what your agent remembers.</p>
        </div>
        <div className="trust-grid">
          {cards.map((c) =>
          <div className="trust-card" key={c.h}>
              <div className="trust-icon">{c.icon}</div>
              <h3 className="trust-h">{c.h}</h3>
              <p className="trust-p">{c.p}</p>
            </div>)}
        </div>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// CTA
// ────────────────────────────────────────────────────────────────────────────
function CTA() {
  return (
    <section className="cta-band" id="get-started">
      <div className="container">
        <div className="eyebrow-row"><span className="eyebrow-pill brand"><span className="dot" />Get started</span></div>
        <h3>Give your agent memory.<br />Under a minute.</h3>
        <p>Run one command. Skip the API key. Skip the integration. Your agent starts remembering immediately.</p>
        <div className="cta-actions">
          <a href="#" className="btn btn-primary btn-lg">npm i @clude/sdk <span className="arr">→</span></a>
          <a href="/docs" className="btn btn-ghost btn-lg">Read the docs</a>
        </div>
        <div className="cta-foot">Free · Open source · MIT · Local-first</div>
      </div>
    </section>);
}

// ────────────────────────────────────────────────────────────────────────────
// FOOTER
// ────────────────────────────────────────────────────────────────────────────
function Footer() {
  const cols = [
  { h: "Product", links: [["SDK", "#"], ["MCP Server", "#"], ["Dashboard", "/dashboard"], ["CLI", "#"], ["Cloud", "#"]] },
  { h: "Developers", links: [["Docs", "/docs"], ["API Reference", "#"], ["Examples", "#"], ["GitHub ↗", "https://github.com/sebbsssss/clude"], ["Changelog", "#"]] },
  { h: "Research", links: [["HaluMem Benchmark", "#"], ["Architecture", "#"], ["Memory Spec", "#"], ["Blog", "#"]] },
  { h: "Company", links: [["About", "#"], ["Careers", "#"], ["Privacy", "/privacy"], ["X ↗", "https://x.com/cludeproject"]] }];
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-top">
          <div className="footer-brand">
            <a href="#" className="nav-brand"><CludeMark className="nav-brand-mark" /><span className="nav-brand-word">Clude</span></a>
            <p>The memory layer for AI agents. Built in the open. Local-first. Yours.</p>
          </div>
          {cols.map((col) =>
          <div className="footer-col" key={col.h}>
              <h4>{col.h}</h4>
              <ul>{col.links.map(([l, href]) => <li key={l}><a href={href}>{l}</a></li>)}</ul>
            </div>)}
        </div>
        <div className="footer-nod">🦞 looking for the lobster? <a href="#">he's over here</a>. Still tired, still helping.</div>
        <div className="footer-bottom" style={{ marginTop: 36 }}>
          <div>© 2026 Clude Labs · MIT licensed</div>
          <div className="footer-bottom-right"><a href="/privacy">Privacy</a><a href="#">Terms</a><a href="#">Security</a></div>
        </div>
      </div>
    </footer>);
}

// ────────────────────────────────────────────────────────────────────────────
// APP — ships light mode (dark canvas), Clude-blue accent, motion layer
// ────────────────────────────────────────────────────────────────────────────
function AppLinear() {
  useEffect(() => {
    if (typeof window.initMotion === "function") {
      const id = requestAnimationFrame(() => window.initMotion());
      return () => cancelAnimationFrame(id);
    }
  }, []);

  return (
    <div className="page">
      {/* Clude blue is the single restrained accent (overrides linear.css default). */}
      <style>{`:root{--brand:#2244FF;--brand-bright:#4E6BFF;--brand-text:#AEB4CC;}`}</style>
      <Nav />
      <Hero />
      <Trusted />
      <HallucinationBand />
      <CompactionSection />
      <ScaleProof />
      <Problem />
      <Insight />
      <MemoryShowcase />
      <HowItWorks />
      <UseCases />
      <Compare />
      <StatsBand />
      <Testimonials />
      <Founder />
      <Trust />
      <CTA />
      <Footer />
    </div>);
}

window.AppLinear = AppLinear;
