/* global React */
// mockups.jsx — faded product mockups + the memory-compaction example (from clude.io).
// Monotone, edge-faded, reveal on scroll. Top-level fns are global to app-linear.jsx.

// ────────────────────────────────────────────────────────────────────────────
// Divergence chart — "Context size per turn". Without memory climbs; Clude stays flat.
// ────────────────────────────────────────────────────────────────────────────
function DivergenceChart() {
  const N = 12;
  const PAD = { l: 60, r: 26, t: 26, b: 46 };
  const W = 880, H = 360;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const yB = PAD.t + plotH;
  const x = (i) => PAD.l + (i / (N - 1)) * plotW;
  const without = Array.from({ length: N }, (_, i) => (i + 1) + 0.14 * (i + 1) * (i + 1));
  const withC = Array.from({ length: N }, () => 1.35);
  const maxRaw = 34;
  const y = (v) => yB - (v / maxRaw) * plotH;

  const linePts = (arr) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const areaPath = (arr) =>
    `M ${x(0)},${yB} ` + arr.map((v, i) => `L ${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ") + ` L ${x(N - 1)},${yB} Z`;

  const grid = [0.25, 0.5, 0.75, 1].map((f) => yB - f * plotH);

  return (
    <svg className="dv-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Context size per turn">
      <defs>
        <linearGradient id="dvWithout" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(150,156,170,0.30)" />
          <stop offset="100%" stopColor="rgba(150,156,170,0)" />
        </linearGradient>
        <linearGradient id="dvWith" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(230,233,242,0.22)" />
          <stop offset="100%" stopColor="rgba(230,233,242,0)" />
        </linearGradient>
      </defs>
      {grid.map((gy, i) => (
        <line key={i} x1={PAD.l} y1={gy} x2={W - PAD.r} y2={gy} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      ))}
      {/* without memory */}
      <path d={areaPath(without)} fill="url(#dvWithout)" />
      <polyline points={linePts(without)} fill="none" stroke="#8A8F98" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* with clude */}
      <path d={areaPath(withC)} fill="url(#dvWith)" />
      <polyline points={linePts(withC)} fill="none" stroke="#EAEDF4" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {/* end dots + labels */}
      <circle cx={x(N - 1)} cy={y(without[N - 1])} r="4" fill="#8A8F98" />
      <circle cx={x(N - 1)} cy={y(withC[N - 1])} r="4" fill="#EAEDF4" />
      <text x={x(N - 1) - 8} y={y(without[N - 1]) - 12} textAnchor="end" className="dv-anno">~14,200 tokens / turn</text>
      <text x={x(N - 1) - 8} y={y(withC[N - 1]) - 12} textAnchor="end" className="dv-anno dim">~1,800 tokens / turn</text>
      {/* axes labels */}
      <text x={PAD.l} y={H - 14} className="dv-axis">Turn 1</text>
      <text x={W - PAD.r} y={H - 14} textAnchor="end" className="dv-axis">Turn 12</text>
      <text x={PAD.l - 12} y={PAD.t + 6} textAnchor="end" className="dv-axis">high</text>
      <text x={PAD.l - 12} y={yB} textAnchor="end" className="dv-axis">0</text>
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MEMORY COMPACTION SECTION — turn-by-turn token savings (~82%)
// ────────────────────────────────────────────────────────────────────────────
function CompactionSection() {
  const stats = [
    { to: 82, suf: "%", pre: "~", display: "~82%", lab: "fewer tokens per session at scale, measured from live chat sessions" },
    { big: "~14.2k → ~1.8k", lab: "avg tokens per turn, without Clude versus with Clude recall" },
    { big: "O(n²) → O(1)", lab: "context cost stops growing with conversation length" }];
  const turns = [
    { q: "Set up the auth service", w: "1,240", c: "1,240", s: "0%" },
    { q: "Add refresh tokens", w: "4,980", c: "1,760", s: "65%" },
    { q: "Why did we split /v1 and /v2?", w: "9,610", c: "1,820", s: "81%" },
    { q: "Wire it into the iOS client", w: "14,180", c: "1,790", s: "87%" }];
  return (
    <section className="compaction" id="compaction">
      <div className="container">
        <div className="section-head">
          <div className="eyebrow-row"><span className="eyebrow-pill">Memory compaction</span></div>
          <h2 className="section-title">See the savings, <span className="quiet">turn by turn.</span></h2>
          <p className="section-lede">
            Every turn, the model re-reads its context. Without memory that's the entire growing transcript. Cost climbs with the square of the conversation. Clude recalls only the ~6 memories that matter (~1.8k tokens), so per-turn context stays flat from turn 1 to turn N.
          </p>
        </div>

        <div className="comp-stats">
          {stats.map((s, i) => (
            <div className="comp-stat" key={i}>
              <div className={"comp-stat-num" + ((s.big || "").includes("→") ? " compact" : "")}
                {...s.to ? { "data-count": true, "data-to": s.to, "data-suf": s.suf || "", "data-pre": s.pre || "", "data-display": s.display } : {}}>
                {s.display || s.big}
              </div>
              <div className="comp-stat-lab">{s.lab}</div>
            </div>
          ))}
        </div>

        <div className="comp-frame mockup-frame reveal">
          <div className="comp-frame-head">
            <div className="comp-frame-title">Context size per turn: the divergence</div>
            <div className="comp-legend">
              <span className="comp-leg"><span className="swatch grow" />Without memory</span>
              <span className="comp-leg"><span className="swatch flat" />With Clude</span>
            </div>
          </div>
          <DivergenceChart />
          <div className="comp-turns">
            <div className="comp-turns-row head">
              <span>Turn</span><span>Without Clude</span><span>With Clude</span><span>Saved</span>
            </div>
            {turns.map((t, i) => (
              <div className="comp-turns-row" key={i}>
                <span className="ct-q">{t.q}</span>
                <span className="ct-w">{t.w}</span>
                <span className="ct-c">{t.c}</span>
                <span className="ct-s">{t.s}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="comp-foot">Headline rate is live from real sessions on <span className="mono">clude.io</span>. The per-turn breakdown is illustrative of the mechanism, not a cherry-picked example.</p>
      </div>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// MEMORY SHOWCASE — a faded product mockup of the memory store / inspector
// ────────────────────────────────────────────────────────────────────────────
function MemoryShowcase() {
  const rows = [
    { type: "episodic", t: "User prefers dense, monochrome UIs. Flagged Inter, rejected rounded cards.", imp: 0.91, age: "2d", cites: 14 },
    { type: "semantic", t: "Auth is split: /v1 kept for the iOS app until v2.3 ships (decided May 4).", imp: 0.86, age: "1w", cites: 9 },
    { type: "procedural", t: "Run LongBench + custom recall eval. HaluMem-v1 and MMLU ruled out.", imp: 0.78, age: "3w", cites: 6 },
    { type: "self-model", t: "Bias lateral recall toward adjacent-but-unexpected: the useful swerve.", imp: 0.72, age: "5w", cites: 4 },
    { type: "semantic", t: "Frontend stack: React 19, no Tailwind, design tokens in CSS vars.", imp: 0.69, age: "6w", cites: 11 },
    { type: "episodic", t: "Shipped the compaction demo; ~82% token reduction confirmed live.", imp: 0.64, age: "8w", cites: 3 }];
  const typeColor = {
    episodic: "var(--clude-episodic)", semantic: "var(--clude-semantic)",
    procedural: "var(--clude-procedural)", "self-model": "var(--clude-self-model)" };
  return (
    <section className="showcase">
      <div className="container">
        <div className="section-head">
          <div className="eyebrow-row"><span className="eyebrow-pill">The memory store</span></div>
          <h2 className="section-title">Memory you can read, <span className="quiet">line by line.</span></h2>
          <p className="section-lede">Not an opaque embedding blob. Every memory is typed, scored for importance, dated, and cite-able. Inspect it, edit it, or wipe it. This is what your agent actually remembers.</p>
        </div>
        <div className="showcase-frame mockup-frame reveal">
          <div className="ms-head">
            <div className="ms-head-left">
              <span className="ms-title">Memory</span>
              <span className="ms-count">1,284 stored · 4 types</span>
            </div>
            <div className="ms-search">⌕ recall: auth decisions…</div>
          </div>
          <div className="ms-cols">
            <span>Type</span><span>Memory</span><span>Importance</span><span>Age</span><span>Cites</span>
          </div>
          <div className="ms-rows">
            {rows.map((r, i) => (
              <div className="ms-row" key={i}>
                <span className="ms-type"><span className="ms-d" style={{ background: typeColor[r.type] }} />{r.type}</span>
                <span className="ms-text">{r.t}</span>
                <span className="ms-imp"><span className="ms-bar"><span className="ms-fill" style={{ width: (r.imp * 100) + "%" }} /></span><b>{r.imp.toFixed(2)}</b></span>
                <span className="ms-age">{r.age}</span>
                <span className="ms-cites">{r.cites}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
