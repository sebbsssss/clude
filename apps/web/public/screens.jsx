// Clude Homepage — Screen art (mini dashboard previews used inside feature cards)

const MEMORY_COLORS = {
  episodic: "#2244FF",
  semantic: "#10B981",
  procedural: "#F59E0B",
  self_model: "#8B5CF6",
  introspective: "#EC4899",
};

function ScreenBar({ title, dots = "neutral" }) {
  const dotClasses = dots === "brand"
    ? ["tl tl--brand", "tl", "tl"]
    : dots === "live"
    ? ["tl tl--green", "tl tl--amber", "tl tl--brand"]
    : ["tl", "tl", "tl"];
  return (
    <div className="screen__bar">
      <span className={dotClasses[0]}></span>
      <span className={dotClasses[1]}></span>
      <span className={dotClasses[2]}></span>
      <span className="screen__title">{title}</span>
    </div>
  );
}

// ---------------- Recall (Search) ----------------
function RecallScreen() {
  const sources = [
    { type: "episodic",     label: "Mar 4 · dev team meeting",       meta: "imp 0.91" },
    { type: "semantic",     label: "support ticket #384",            meta: "imp 0.74" },
    { type: "procedural",   label: "ops/runbook.md",                 meta: "imp 0.68" },
    { type: "self_model",   label: "Slack · #eng-platform · Apr 2",  meta: "imp 0.52" },
  ];
  return (
    <div className="screen">
      <ScreenBar title="cortex · recall" dots="live" />
      <div className="screen__body">
        <div className="recall__query">
          <span className="prompt">›</span>
          <span>has the PR #83 issue been fixed?</span>
          <span className="recall__cursor"></span>
        </div>
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: 10}}>
          <span style={{fontFamily:"var(--font-mono)", fontSize:9, letterSpacing:"0.2em", color:"var(--fg-3)", textTransform:"uppercase", fontWeight:700}}>4 sources · hybrid match</span>
          <span style={{fontFamily:"var(--font-mono)", fontSize:9, color:"var(--fg-3)", letterSpacing:"0.06em"}}>0.04ms</span>
        </div>
        {sources.map((s, i) => (
          <div className="recall__source" key={i}>
            <span className="recall__dot" style={{background: MEMORY_COLORS[s.type]}}></span>
            <span className="recall__src-label">{s.label}</span>
            <span className="recall__src-meta">{s.meta}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Answer with sources ----------------
function AnswerScreen() {
  return (
    <div className="screen">
      <ScreenBar title="cortex · answer" dots="brand" />
      <div className="screen__body">
        <p className="answer__line">
          The part you mentioned appears to be from an earlier version. Based on
          the March 4 dev team meeting<span className="answer__cite">1</span>,
          support ticket #384<span className="answer__cite">2</span>, and the
          operations runbook<span className="answer__cite">3</span>, the issue
          has already been resolved.
        </p>
        <div className="answer__sources">
          <div className="answer__source-row">
            <span className="answer__cite-num">[1]</span>
            <span style={{flex:1, color:"var(--fg-1)"}}>dev-meeting · 2026-03-04</span>
            <span style={{color:"var(--fg-3)"}}>imp 0.91</span>
          </div>
          <div className="answer__source-row">
            <span className="answer__cite-num">[2]</span>
            <span style={{flex:1, color:"var(--fg-1)"}}>support #384 · resolved</span>
            <span style={{color:"var(--fg-3)"}}>imp 0.74</span>
          </div>
          <div className="answer__source-row">
            <span className="answer__cite-num">[3]</span>
            <span style={{flex:1, color:"var(--fg-1)"}}>ops/runbook.md · §4.2</span>
            <span style={{color:"var(--fg-3)"}}>imp 0.68</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Save to memory ----------------
function SaveScreen() {
  return (
    <div className="screen">
      <ScreenBar title="cortex · store" dots="live" />
      <div className="screen__body">
        <div className="save__memcard">
          <div className="save__memhead">
            <span style={{width:8,height:8,borderRadius:"50%",background:MEMORY_COLORS.semantic, display:"inline-block"}}></span>
            <span>SEMANTIC · NEW</span>
            <span style={{marginLeft:"auto", letterSpacing:0, color:"var(--fg-3)", fontSize:10, textTransform:"none"}}>Apr 21 · 14:08</span>
          </div>
          <div className="save__memcontent">
            Prevent recurrence of issues from PR #83 — always run schema check
            against staging before merge.
          </div>
          <div className="save__memmeta">
            <span>imp 0.84</span>
            <span style={{color:"var(--fg-4)"}}>·</span>
            <span>decay 1.00</span>
            <span style={{color:"var(--fg-4)"}}>·</span>
            <span>2 bonds</span>
          </div>
        </div>
        <div className="save__toast">
          <span className="check">✓</span>
          <span>Saved to team memory · clude-research</span>
        </div>
      </div>
    </div>
  );
}

// ---------------- Handoff ----------------
function HandoffScreen() {
  return (
    <div className="screen">
      <ScreenBar title="cortex · handoff" />
      <div className="screen__body" style={{padding:14}}>
        <div className="handoff">
          <div className="handoff__row">
            <div className="handoff__avatar">JS</div>
            <div>
              <div className="handoff__name">Jason · Sales</div>
              <div className="handoff__role">Source · 412 memories</div>
            </div>
            <span className="handoff__pill">EXPORT</span>
          </div>
          <div className="handoff__arrow">↓ pack · 412 memories</div>
          <div className="handoff__row">
            <div className="handoff__avatar">TM</div>
            <div>
              <div className="handoff__name">Tom · Dev</div>
              <div className="handoff__role">Imported · context ready</div>
            </div>
            <span className="handoff__pill handoff__pill--brand">CLAUDE</span>
          </div>
          <div className="handoff__row">
            <div className="handoff__avatar">CK</div>
            <div>
              <div className="handoff__name">Chloe · HR</div>
              <div className="handoff__role">Imported · context ready</div>
            </div>
            <span className="handoff__pill handoff__pill--brand">CHATGPT</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Decay heatmap mini ----------------
function DecayMini() {
  const rows = [
    { type: "episodic",     rate: 0.07 },
    { type: "semantic",     rate: 0.02 },
    { type: "procedural",   rate: 0.03 },
    { type: "self_model",   rate: 0.01 },
    { type: "introspective",rate: 0.04 },
  ];
  const cols = 10;
  function rgba(hex, a) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0,2),16);
    const g = parseInt(h.slice(2,4),16);
    const b = parseInt(h.slice(4,6),16);
    return `rgba(${r},${g},${b},${a*0.92})`;
  }
  return (
    <div className="decay-mini">
      <div className="decay-mini__head">
        <span className="eyebrow eyebrow--ink">Decay · 10 days</span>
        <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--fg-3)", letterSpacing:"0.06em"}}>D-9 → today</span>
      </div>
      <div className="decay-mini__rows">
        {rows.map(r => (
          <div className="decay-mini__row" key={r.type}>
            <div className="decay-mini__label">
              <span className="dot" style={{background: MEMORY_COLORS[r.type]}}></span>
              {r.type.replace("_","-")}
            </div>
            {Array.from({length: cols}).map((_, c) => {
              const days = (cols-1) - c;
              const strength = Math.pow(1 - r.rate, days);
              return (
                <div className="decay-mini__cell" key={c} style={{background: rgba(MEMORY_COLORS[r.type], strength)}} />
              );
            })}
          </div>
        ))}
      </div>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:14, paddingTop:10, borderTop:"1px solid var(--line)"}}>
        <span className="eyebrow">Rate / day</span>
        <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--fg-2)", letterSpacing:"0.06em"}}>
          7% · 2% · 3% · 1% · 4%
        </span>
      </div>
    </div>
  );
}

// ---------------- Hybrid search ----------------
function HybridScreen() {
  const bars = [
    { label: "Keyword",    val: 0.42, cls: "" },
    { label: "Semantic",   val: 0.78, cls: "hybrid__bar-fill--g" },
    { label: "Relation",   val: 0.61, cls: "hybrid__bar-fill--p" },
    { label: "Recency",    val: 0.34, cls: "hybrid__bar-fill--v" },
  ];
  return (
    <div className="hybrid">
      <div className="hybrid__head">
        <span className="hybrid__status">
          <span className="dot"></span>
          Hybrid match
        </span>
        <span className="hybrid__time">resp <strong>0.04ms</strong></span>
      </div>
      <div className="hybrid__bars">
        {bars.map(b => (
          <div className="hybrid__bar-row" key={b.label}>
            <span className="hybrid__bar-label">{b.label}</span>
            <span className="hybrid__bar-track">
              <span className={"hybrid__bar-fill " + b.cls} style={{width: `${b.val*100}%`}}></span>
            </span>
            <span className="hybrid__bar-val">{b.val.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="hybrid__result">
        <strong style={{fontWeight:600}}>Top match · </strong>
        "Schema check is required before merge — added after PR #83 incident."
        <div className="hybrid__result-meta">
          <span style={{color:"var(--clude-semantic)", fontWeight:600}}>SEMANTIC</span>
          <span style={{color:"var(--fg-4)"}}>·</span>
          <span>imp 0.84</span>
          <span style={{color:"var(--fg-4)"}}>·</span>
          <span>decay 0.96</span>
        </div>
      </div>
    </div>
  );
}

// ---------------- Hero visual: Dashboard preview ----------------
function HeroDashboard() {
  return (
    <div style={{position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", padding:24, zIndex:1}}>
      <div className="screen" style={{maxWidth:520, width:"100%"}}>
        <ScreenBar title="cortex.recall · live" dots="live" />
        <div className="screen__body">
          <div style={{display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:1, background:"var(--line)", border:"1px solid var(--line)", marginBottom:16}}>
            {[
              { label:"MEMORIES", val:"3,247", color:null },
              { label:"HALUMEM", val:"1.96%", color:"var(--brand)" },
              { label:"DREAM", val:"03:00", color:null },
            ].map(s => (
              <div key={s.label} style={{background:"var(--bg-1)", padding:"14px 12px"}}>
                <div style={{fontFamily:"var(--font-mono)", fontSize:22, fontWeight:700, letterSpacing:"-0.01em", lineHeight:1, color: s.color || "var(--fg-1)", fontVariantNumeric:"tabular-nums"}}>{s.val}</div>
                <div style={{fontFamily:"var(--font-mono)", fontSize:9, fontWeight:600, letterSpacing:"0.18em", color:"var(--fg-3)", marginTop:6}}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
            <span className="eyebrow eyebrow--ink">Recent · 4</span>
            <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--fg-3)", letterSpacing:"0.06em"}}>filter: all types</span>
          </div>
          <div style={{display:"flex", flexDirection:"column", border:"1px solid var(--line)"}}>
            {[
              { type:"episodic",   text:"Seb showed me HaluMem: 1.96% vs 15.2% next best.", time:"14:02" },
              { type:"semantic",   text:"Clinamen: lateral swerve recall.",                  time:"13:48" },
              { type:"procedural", text:"npx @clude/sdk setup writes ~/.clude/config.json.", time:"12:17" },
              { type:"self_model", text:"I prefer short, precise summaries. I cite when I claim.", time:"yest" },
            ].map((m, i) => (
              <div key={i} style={{display:"grid", gridTemplateColumns:"14px 1fr auto", alignItems:"center", gap:10, padding:"10px 12px", borderBottom: i<3 ? "1px solid var(--line)" : "0", fontFamily:"var(--font-mono)", fontSize:11}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:MEMORY_COLORS[m.type]}}></span>
                <span style={{color:"var(--fg-1)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{m.text}</span>
                <span style={{color:"var(--fg-3)", fontVariantNumeric:"tabular-nums"}}>{m.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Clude Chat screen ----------------
function ChatScreen() {
  return (
    <div style={{position:"relative", width:"100%", maxWidth:520}}>
      <div className="chat">
        <div className="chat__bar">
          <div className="chat__bar-left">
            <span className="tl tl--brand"></span>
            <span className="tl tl--green"></span>
            <span className="tl tl--amber"></span>
            <span className="chat__bar-title">clude · chat</span>
          </div>
          <div className="chat__model">
            <span className="chat__model-dot"></span>
            <span>Claude Sonnet 4.5</span>
            <span style={{color:"var(--fg-3)"}}>▾</span>
          </div>
        </div>
        <div className="chat__body">
          <div className="chat__msg">
            <div className="chat__avatar">SK</div>
            <div className="chat__bubble">
              Has the issue from PR #83 been fixed yet?
            </div>
          </div>
          <div className="chat__msg">
            <div className="chat__avatar chat__avatar--ai">C</div>
            <div className="chat__bubble">
              Yes — resolved on Mar 4. The dev team added a staging schema check before merge, and ticket #384 was closed shortly after.
              <div className="chat__chips">
                <span className="chat__memchip"><span className="dot" style={{background:"#2244FF"}}></span>dev-meeting · mar 4</span>
                <span className="chat__memchip"><span className="dot" style={{background:"#10B981"}}></span>ticket #384</span>
                <span className="chat__memchip"><span className="dot" style={{background:"#F59E0B"}}></span>runbook §4.2</span>
              </div>
            </div>
          </div>
        </div>
        <div className="chat__compose">
          <div className="chat__input">Ask anything · context auto-loaded</div>
          <button className="chat__send">Send</button>
        </div>
      </div>
      <div className="modelpicker">
        <div className="modelpicker__head">
          <span className="modelpicker__title">Models · 12</span>
          <span style={{fontFamily:"var(--font-mono)", fontSize:9, color:"var(--fg-3)", letterSpacing:"0.1em"}}>BYO key · or hosted</span>
        </div>
        <div className="modelpicker__list">
          {[
            { name:"Claude Sonnet 4.5", prov:"Anthropic",  pill:"PRO",   active:true },
            { name:"GPT-5",             prov:"OpenAI",     pill:"PRO" },
            { name:"Gemini 2.5 Pro",    prov:"Google",     pill:"PRO" },
            { name:"Llama 4 405B",      prov:"Meta",       pill:"FREE" },
            { name:"Mistral Large",     prov:"Mistral",    pill:"PRO" },
            { name:"DeepSeek R2",       prov:"DeepSeek",   pill:"FREE" },
            { name:"Qwen 3 72B",        prov:"local",      pill:"LOCAL" },
          ].map(m => (
            <div key={m.name} className={"modelpicker__item " + (m.active ? "modelpicker__item--active" : "")}>
              <span className="modelpicker__check">{m.active ? "✓" : ""}</span>
              <span>{m.name}</span>
              <span className="modelpicker__provider">{m.prov}</span>
              <span className={"modelpicker__pill modelpicker__pill--" + m.pill.toLowerCase()}>{m.pill}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  RecallScreen, AnswerScreen, SaveScreen, HandoffScreen,
  DecayMini, HybridScreen, HeroDashboard, ChatScreen, MEMORY_COLORS,
});
