import type { ReactNode } from 'react';

// Today tab — the daily-driver Jarvis surface ported from the
// claude.ai/design Clude Knowledge Wiki handoff. Mock content for now;
// will hook into real recall / open-loops APIs in a follow-up.

export function TodayTab({ onAsk }: { onAsk: () => void }) {
  return (
    <div className="wk-today">
      <TodayHero />
      <NowBar onAsk={onAsk} />
      <BriefingHero />
      <PrioritySection />
      <ResurfaceSection />
      <LoopsSection />
    </div>
  );
}

function TodayHero() {
  return (
    <header className="wk-today-hero">
      <div className="wk-today-hero__left">
        <div className="wk-eyebrow">
          <span className="wk-eyebrow__crumb">JARVIS</span>
          <span className="wk-eyebrow__sep">/</span>
          <span style={{ color: 'var(--fg-1)' }}>TODAY</span>
        </div>
        <h1 className="wk-today-hero__title">
          <span className="wk-today-hero__glyph">◈</span>
          Today
          <span className="wk-today-hero__sub">
            · what your second brain knows and wants you to do
          </span>
        </h1>
        <p className="wk-today-hero__lede">
          A live briefing from Clude. Three priorities, what's connected to them, and the past conversations that matter for today's work.
        </p>
      </div>
      <div className="wk-today-hero__kv">
        <div>
          <span className="wk-kv__label">Mode</span>
          <span className="wk-kv__value" style={{ color: 'var(--clude-success)' }}>● LISTENING</span>
        </div>
        <div>
          <span className="wk-kv__label">Resurfaced</span>
          <span className="wk-kv__value">5</span>
        </div>
        <div>
          <span className="wk-kv__label">Open loops</span>
          <span className="wk-kv__value">7</span>
        </div>
        <div>
          <span className="wk-kv__label">Last dream</span>
          <span className="wk-kv__value">3:02 AM</span>
        </div>
      </div>
    </header>
  );
}

function NowBar({ onAsk }: { onAsk: () => void }) {
  return (
    <div className="wk-nowbar">
      <div className="wk-nowbar__pulse">
        <span className="wk-nowbar__pulse-dot" />
        <span>Active now</span>
      </div>
      <div>
        <div className="wk-nowbar__what">
          You are working in <strong>research-agent · investor-deck-v3</strong>
        </div>
        <div className="wk-nowbar__what-meta">
          Cludebot is listening · 4 fragments stored in last 90 min · Friday call in 2 days
        </div>
      </div>
      <div className="wk-nowbar__chips">
        <button type="button" className="wk-nowbar__chip">+ Capture thought</button>
        <button type="button" className="wk-nowbar__chip" onClick={onAsk}>✦ Reframe</button>
        <button type="button" className="wk-nowbar__chip">◇ Dream cycle</button>
      </div>
    </div>
  );
}

function BriefingHero() {
  return (
    <section className="wk-brief">
      <div className="wk-brief__main">
        <div className="wk-brief__greeting">
          <span className="wk-brief__greeting-dot" />
          <span>Good morning, Seb · briefing · 9:14 AM</span>
        </div>
        <p className="wk-brief__line">
          Three things matter today. <em>Pricing</em> is unresolved before Friday — <span className="wk-brief__mention">@anya</span> and you disagree
          and the deck depends on it. The <em>HaluMem 1.96% number</em> from yesterday's run
          is your strongest headline; I've pulled the supporting fragments. And you've been
          debugging consolidation three Fridays in a row — I think it's structural, not tactical.
        </p>
        <ul className="wk-brief__bullets">
          <li>
            <span className="wk-brief__bullet-glyph">◇</span>
            <span><strong>5 past conversations</strong> resurfaced because they link to what you're touching today</span>
            <span className="wk-brief__bullet-time">9:14 AM</span>
          </li>
          <li>
            <span className="wk-brief__bullet-glyph">⚠</span>
            <span><strong>1 contradiction</strong> between fragments — old README says 5%/day, fresh benchmark says 7%/day</span>
            <span className="wk-brief__bullet-time">8:48 AM</span>
          </li>
          <li>
            <span className="wk-brief__bullet-glyph">✦</span>
            <span><strong>Dream cycle</strong> ran overnight — consolidated 14 fragments into <strong>Memory Decay</strong></span>
            <span className="wk-brief__bullet-time">3:02 AM</span>
          </li>
        </ul>
      </div>
      <aside className="wk-brief__side">
        <div className="wk-brief__date">
          <span className="wk-brief__date-day">Wed 13</span>
          <span className="wk-brief__date-meta">May 2026 · w20</span>
        </div>
        <div className="wk-brief__stat-row">
          <span className="wk-brief__stat-label">Memories</span>
          <span className="wk-brief__stat-value">1,284</span>
          <span className="wk-brief__stat-sub">+47 this week · 14 reframed today</span>
        </div>
        <div className="wk-brief__stat-row">
          <span className="wk-brief__stat-label">Open loops</span>
          <span className="wk-brief__stat-value">7</span>
          <span className="wk-brief__stat-sub">3 awaiting decision · 2 contradicting</span>
        </div>
        <div className="wk-brief__stat-row">
          <span className="wk-brief__stat-label">Next milestone</span>
          <span className="wk-brief__stat-value" style={{ fontSize: 14, lineHeight: 1.3 }}>Investor call</span>
          <span className="wk-brief__stat-sub">Fri 15 May · 14:00</span>
        </div>
      </aside>
    </section>
  );
}

type PriorityKind = 'decide' | 'ship' | 'notice';
type PrioritySource = { label: string; time: string; color: string };

function PrioritySection() {
  return (
    <section>
      <div className="wk-today__sectionhead">
        <div>
          <div className="wk-today__sectionhead-eyebrow">What matters today</div>
          <h2>Three things, in priority order</h2>
        </div>
        <span className="wk-today__sectionhead-meta">ranked by importance × decay × due-date proximity</span>
      </div>
      <div className="wk-priority">
        <PriorityCard
          kind="decide"
          kindLabel="Decide"
          due="Before Fri 15"
          title="Pricing model: per-token or per-memory?"
          why={
            <>
              <strong>@anya</strong> proposed per-memory at Tuesday standup. Your <strong>11pm planning doc</strong> specifies per-token.
              Both rationales are sound and they're mutually exclusive. The deck slide 7 won't write itself until this is resolved.
            </>
          }
          links={[
            { label: "Anya — 'per-memory keeps incentives honest'", time: 'Tue 4:12pm', color: '#10B981' },
            { label: "Your 11pm doc — 'per-token is the only honest unit'", time: 'Mon 11:08pm', color: '#8B5CF6' },
            { label: "Investor Q from intro call — 'how do you price?'", time: 'Apr 28', color: '#F59E0B' },
          ]}
          actions={['Open thread', 'Schedule decision']}
        />
        <PriorityCard
          kind="ship"
          kindLabel="Ship"
          due="By Fri"
          title="Investor deck v3 — lead with HaluMem 1.96%"
          why={
            <>
              Run #847 confirms <strong>7.7× lead</strong> over Mem0. The narrative writes itself if you front-load it.
              I've pulled 4 past fragments where you tried different framings — the one from <strong>Apr 28</strong> landed best
              with the previous investor.
            </>
          }
          links={[
            { label: 'HaluMem run #847 · 1.96% / Mem0 15.2%', time: 'Tue 8:34pm', color: '#F59E0B' },
            { label: "Apr 28 framing that worked: 'we forget on purpose'", time: '16 days ago', color: '#2244FF' },
            { label: "Anya's slide draft v2 (needs rewrite)", time: 'Mon 9am', color: '#10B981' },
          ]}
          actions={['Open deck', 'Pull fragments']}
        />
        <PriorityCard
          kind="notice"
          kindLabel="Notice"
          due="Pattern"
          title="Third Friday debugging consolidation"
          why={
            <>
              You've spent the last <strong>three Fridays</strong> on the same edge case in the consolidation pass.
              Each time you wrote a fragment saying <em>"something is structurally off"</em> and then context-switched.
              I think this isn't a tactical bug — it's worth a half-day rewrite.
            </>
          }
          links={[
            { label: "May 9 — 'tired, third friday'", time: '4 days ago', color: '#8B5CF6' },
            { label: "May 2 — 'same edge case as last week'", time: '11 days ago', color: '#8B5CF6' },
            { label: "Apr 25 — 'consolidation pass is fragile'", time: '18 days ago', color: '#8B5CF6' },
          ]}
          actions={['Block calendar', 'Snooze']}
        />
      </div>
    </section>
  );
}

function PriorityCard({
  kind, kindLabel, due, title, why, links, actions,
}: {
  kind: PriorityKind;
  kindLabel: string;
  due: string;
  title: string;
  why: ReactNode;
  links: PrioritySource[];
  actions: string[];
}) {
  return (
    <article className="wk-priocard">
      <div className="wk-priocard__head">
        <span className={`wk-priocard__kind wk-priocard__kind--${kind}`}>{kindLabel}</span>
        <span className="wk-priocard__due">{due}</span>
      </div>
      <h3 className="wk-priocard__title">{title}</h3>
      <p className="wk-priocard__why">{why}</p>
      <div className="wk-priocard__links">
        {links.map((l, i) => (
          <div key={i} className="wk-priocard__link">
            <span className="wk-cdot" style={{ background: l.color, width: 6, height: 6, borderRadius: '50%' }} />
            <span className="wk-priocard__link-label">{l.label}</span>
            <span className="wk-priocard__link-time">{l.time}</span>
          </div>
        ))}
      </div>
      <div className="wk-priocard__actions">
        {actions.map((a, i) => (
          <button key={a} type="button" className={`wk-mini-btn ${i === 0 ? 'wk-mini-btn--brand' : ''}`}>{a}</button>
        ))}
      </div>
    </article>
  );
}

type Resurface = {
  when: string;
  whenSub: string;
  quote: string;
  whyTo: string;
  whyTopic: string;
  source: string;
  sourceColor: string;
  meta: string;
};

function ResurfaceSection() {
  const resurfaced: Resurface[] = [
    {
      when: 'Mon', whenSub: 'May 11',
      quote: 'If we ever do per-token pricing, we need to expose decay as a tunable — otherwise heavy users pay for memory they don\'t access.',
      whyTo: 'Pricing model decision',
      whyTopic: 'Billing Model',
      source: 'Seb',
      sourceColor: '#8B5CF6',
      meta: 'via fragment f-094 · imp 0.81',
    },
    {
      when: 'Apr 28', whenSub: '16 days',
      quote: 'The pitch that worked: \'we forget on purpose, and that\'s the whole product.\' She got it in 4 seconds.',
      whyTo: 'Investor deck v3 framing',
      whyTopic: 'Shipping Rituals',
      source: 'Seb',
      sourceColor: '#8B5CF6',
      meta: 'imp 0.93 · accessed 6×',
    },
    {
      when: 'Apr 25', whenSub: '18 days',
      quote: 'consolidation pass is fragile when bond weights exceed 0.85. should rewrite the merging step properly someday.',
      whyTo: 'Third-Friday debugging pattern',
      whyTopic: 'Agent Loops',
      source: '@Cludebot',
      sourceColor: '#2244FF',
      meta: 'f-061 · low decay (0.42)',
    },
    {
      when: 'Apr 12', whenSub: '1 mo',
      quote: 'Park et al. 2023 reflect on top-N important memories. We weight by importance × recency × relevance. Worth a footnote in the paper.',
      whyTo: 'HaluMem deck — supporting research',
      whyTopic: 'Stanford Agents',
      source: 'research-agent',
      sourceColor: '#2244FF',
      meta: 'f-038 · cited 3×',
    },
    {
      when: 'Mar 30', whenSub: '6 wk',
      quote: 'Anya said \'per-memory keeps incentives honest\' over drinks. I disagreed but didn\'t push back enough.',
      whyTo: 'Pricing model decision',
      whyTopic: 'Billing Model',
      source: 'Seb',
      sourceColor: '#8B5CF6',
      meta: 'imp 0.68 · introspective',
    },
  ];
  const ticks = ['6 wk', '1 mo', '18 d', '16 d', 'Mon', 'Yest', 'Today'];

  return (
    <section>
      <div className="wk-today__sectionhead">
        <div>
          <div className="wk-today__sectionhead-eyebrow">Pulled forward</div>
          <h2>Past conversations that connect to today</h2>
        </div>
        <span className="wk-today__sectionhead-meta">retrieved by topic similarity · sorted by relevance</span>
      </div>
      <div className="wk-spine">
        <div className="wk-spine__axis">
          <div className="wk-spine__line" />
          <div className="wk-spine__ticks">
            {ticks.map((t, i) => (
              <span key={i} className={`wk-spine__tick ${i === ticks.length - 1 ? 'is-today' : ''}`}>{t}</span>
            ))}
          </div>
        </div>
        <div className="wk-spine__memories">
          {resurfaced.map((r, i) => (
            <div key={i} className="wk-resurface">
              <div className="wk-resurface__when">
                <strong>{r.when}</strong>
                {r.whenSub}
              </div>
              <div className="wk-resurface__body">
                <p className="wk-resurface__quote">{r.quote}</p>
                <div className="wk-resurface__why">
                  <span className="wk-resurface__why-glyph">↳</span>
                  <span className="wk-resurface__why-target">connects to <strong>{r.whyTo}</strong> · via <strong>{r.whyTopic}</strong></span>
                </div>
              </div>
              <div className="wk-resurface__meta">
                <div className="wk-resurface__source">
                  <span className="wk-cdot" style={{ background: r.sourceColor, width: 7, height: 7, borderRadius: '50%' }} />
                  <span>{r.source}</span>
                </div>
                <span>{r.meta}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type Loop = {
  color: string;
  kind: string;
  age: string;
  q: string;
  sub: ReactNode;
};

function LoopsSection() {
  const decisions: Loop[] = [
    {
      color: '#F59E0B',
      kind: 'Decision · awaiting',
      age: '2 days open',
      q: 'Pricing model: per-token vs per-memory?',
      sub: <><strong>2 sources</strong> · contradicting · Anya proposed per-memory, Seb's 11pm doc says per-token. <strong>Friday deadline</strong>.</>,
    },
    {
      color: '#F59E0B',
      kind: 'Decision · awaiting',
      age: '5 days open',
      q: 'Expose decay as SDK tunable or keep it internal?',
      sub: <>Asked by <strong>3 developers</strong> in the last week. Trade-off: <strong>simpler API</strong> vs <strong>customer agency</strong>.</>,
    },
    {
      color: '#EC4899',
      kind: 'Question · self',
      age: '1 wk open',
      q: "Should the agent be able to mark a memory 'do not decay'?",
      sub: <>Surfaced by <strong>@Cludebot</strong> last Friday. Current workaround is importance=1.0, which is a hack.</>,
    },
  ];
  const motions: Loop[] = [
    {
      color: '#2244FF',
      kind: 'In motion',
      age: 'ships Fri',
      q: 'Investor deck v3 — slide 7 still empty',
      sub: <>Depends on pricing decision. <strong>Anya</strong> has a draft. Recommended framing: <em>"we forget on purpose"</em>.</>,
    },
    {
      color: '#10B981',
      kind: 'In motion',
      age: 'this week',
      q: 'Decay tunable doc rewrite',
      sub: <><strong>@Cludebot</strong> noticed users ask this 3×/week. Should be moved from API docs to SDK README header.</>,
    },
    {
      color: '#8B5CF6',
      kind: 'Watching',
      age: 'soft',
      q: 'Friday-debugging pattern',
      sub: <>3 consecutive Fridays on the same edge case. <strong>I'd recommend blocking a half-day</strong> for a proper rewrite.</>,
    },
  ];

  return (
    <section>
      <div className="wk-today__sectionhead">
        <div>
          <div className="wk-today__sectionhead-eyebrow">Open loops</div>
          <h2>Questions waiting on you · work in motion</h2>
        </div>
        <span className="wk-today__sectionhead-meta">6 open · oldest 1 wk</span>
      </div>
      <div className="wk-loops">
        <div className="wk-loops__col">
          {decisions.map((d, i) => <LoopCard key={i} {...d} />)}
        </div>
        <div className="wk-loops__col">
          {motions.map((d, i) => <LoopCard key={i} {...d} />)}
        </div>
      </div>
    </section>
  );
}

function LoopCard({ color, kind, age, q, sub }: Loop) {
  return (
    <article className="wk-loop">
      <div className="wk-loop__head">
        <span className="wk-cdot" style={{ background: color, width: 8, height: 8, borderRadius: '50%' }} />
        <span>{kind}</span>
        <span className="wk-loop__head-age">{age}</span>
      </div>
      <p className="wk-loop__q">{q}</p>
      <p className="wk-loop__sub">{sub}</p>
      <div className="wk-loop__foot">
        <button type="button" className="wk-mini-btn">Open thread</button>
        <button type="button" className="wk-mini-btn">Snooze</button>
        <button type="button" className="wk-mini-btn">Resolve</button>
        <span className="wk-loop__voters">3 fragments · 2 backlinks</span>
      </div>
    </article>
  );
}
