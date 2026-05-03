// Work-focused dataset for /showcase/wiki. Memories spread across weeks of
// conversations to make the persistence story tangible — the agent has been
// remembering this stuff since well before today.

import type { Memory } from '../../types/memory';
import type { ContradictionPair, GraphMemoryNode } from './use-wiki-data';

interface SeedRow {
  topic: string;
  source: string;
  type: Memory['memory_type'];
  importance: number;
  minutesAgo: number;
  content: string;
  summary?: string;
  compacted?: boolean;
}

const SEED: SeedRow[] = [
  // ── q3-roadmap ──
  { topic: 'q3-roadmap', source: 'standup notes', type: 'semantic', importance: 0.94, minutesAgo: 60,
    content: "team agreed: Q3 ships are auth migration, the new dashboard, and the export pipeline. brain-trust feature is cut. lina pushed back but the data isn't there.",
    summary: "Q3 commits: auth migration, new dashboard, export pipeline. Brain-trust feature cut despite Lina's pushback — usage data didn't justify the build cost." },
  { topic: 'q3-roadmap', source: 'planning doc', type: 'semantic', importance: 0.86, minutesAgo: 4320,
    content: "the framing question for Q3 is 'what unblocks customer #1's renewal'. ranking by that filter changes the order — auth has to ship first because their security review is in week 3.",
    summary: "Q3 priority filter: 'what unblocks the top customer's renewal'. Auth ships first because their security review is in week 3 — non-negotiable date." },
  { topic: 'q3-roadmap', source: '1:1 with maya', type: 'episodic', importance: 0.78, minutesAgo: 7200,
    content: "maya wants to take on the export pipeline. she has more context than anyone else after the spike last quarter. assign it to her formally next week.",
    summary: "Decision: assign export pipeline to Maya — she has the most context from last quarter's spike. Make it formal in next week's planning." },
  { topic: 'q3-roadmap', source: 'retro notes', type: 'semantic', importance: 0.62, minutesAgo: 28800,
    content: "what we missed in Q2: didn't budget time for migrations, again. third quarter in a row. need to actually pad the estimates this time.", compacted: true },

  // ── auth-migration ──
  { topic: 'auth-migration', source: 'incident slack', type: 'episodic', importance: 0.97, minutesAgo: 35,
    content: "auth rollout broke at 2:14am. session-cookie fallback wasn't preserving the org_id claim. rolled back in 11 min. ari has the postmortem.",
    summary: "Auth rollout failed at 2:14am — fallback path didn't preserve org_id. 11-minute rollback. Ari owns the postmortem; full RCA by Thursday." },
  { topic: 'auth-migration', source: 'design doc', type: 'procedural', importance: 0.88, minutesAgo: 2880,
    content: "decision: dual-stack JWT + session cookies for 2 weeks, then cookie removal. the cutover gate is 'jwt error rate under 0.05% for 72 hours straight'.",
    summary: "Migration plan: dual-stack JWT + session cookies for 2 weeks, then cookie removal. Cutover gate is JWT error rate under 0.05% for 72h straight." },
  { topic: 'auth-migration', source: 'code review', type: 'semantic', importance: 0.74, minutesAgo: 5760,
    content: "the refresh token flow needs to clamp the renewal window so a stale token can't extend itself indefinitely. saw this in two existing PRs that need to be revisited.",
    summary: "Refresh token renewal window must be clamped — otherwise stale tokens self-extend. Found this issue in two existing PRs that need revisiting." },
  { topic: 'auth-migration', source: 'design doc', type: 'episodic', importance: 0.51, minutesAgo: 14400,
    content: "looked at how stripe handles their auth migration. they ran a 5-week parallel period. we're doing 2. that's tight but their scale is different.", compacted: true },

  // ── customer-research ──
  { topic: 'customer-research', source: 'customer call', type: 'semantic', importance: 0.91, minutesAgo: 240,
    content: "5th customer asking about audit logs in 3 weeks. they keep framing it as 'we can't deploy without SOC2 evidence.' this is the buy-blocker for enterprise.",
    summary: "Audit logs = the recurring enterprise buy-blocker. 5 customers in 3 weeks framed it as 'no SOC2 evidence, no deployment.' Needs roadmap action." },
  { topic: 'customer-research', source: 'customer call', type: 'semantic', importance: 0.83, minutesAgo: 1440,
    content: "noticed: nobody asks about the brain-trust feature anymore. used to be the top question 6 months ago. either we explained it well or it stopped mattering. probably the latter.",
    summary: "Brain-trust feature: zero questions in 6 months. Was the top ask before. Strong signal that the feature stopped mattering — supports the Q3 cut decision." },
  { topic: 'customer-research', source: 'email thread', type: 'semantic', importance: 0.79, minutesAgo: 5760,
    content: "across the last 14 calls: 11 mentioned 'compliance' unprompted; 9 mentioned 'team workspace'; 3 asked about pricing. the order of priority is clearer than i expected.",
    summary: "Last 14 calls: compliance (11 mentions, unprompted) → team workspace (9) → pricing (3). Customers care about the first two; pricing isn't the friction we thought." },
  { topic: 'customer-research', source: '1:1 with anya', type: 'episodic', importance: 0.66, minutesAgo: 11520,
    content: "anya pointed out we keep mishearing 'i want X' as 'X is the most important thing'. customers say 'I want audit logs' but mean 'I want to feel safe deploying.' the underlying need matters more.",
    summary: "Anya's insight: customers say 'I want X' but mean 'I want to feel Y'. We keep treating literal asks as priorities — should map to underlying needs first." },

  // ── pricing-model ──
  { topic: 'pricing-model', source: 'planning meeting', type: 'episodic', importance: 0.92, minutesAgo: 90,
    content: "anya wants per-seat pricing. predictable for finance, easy to reason about. seb still wants per-token. these are different pricing models entirely.",
    summary: "Active conflict: Anya wants per-seat pricing (predictable, easy for finance); Seb wants per-token (aligned with usage). Decision needed before Friday." },
  { topic: 'pricing-model', source: 'design doc', type: 'semantic', importance: 0.81, minutesAgo: 720,
    content: "per-token usage. charge for inference, not seats. seats discourage adoption — every team adds 'just the people who really need it' which is the opposite of what we want.",
    summary: "Per-token argument: charge for inference, not seats. Seat-based pricing limits team adoption (people opt out to save cost) — opposite of growth we want." },
  { topic: 'pricing-model', source: 'investor email', type: 'semantic', importance: 0.74, minutesAgo: 4320,
    content: "investor pushback on hybrid pricing: 'pick one. you can change later but ship one model first or you'll spend a quarter explaining yourself instead of selling.'",
    summary: "Investor advice: pick ONE pricing model and ship it. Hybrid forces you to spend a quarter explaining yourself instead of selling. Change later if needed." },

  // ── demo-day-prep ──
  { topic: 'demo-day-prep', source: 'rehearsal notes', type: 'episodic', importance: 0.89, minutesAgo: 180,
    content: "ran the full demo. the persistence reveal lands every time. when the agent recalls something from 'last week' the room goes quiet. that's the moment to lean on.",
    summary: "Demo strongest moment: the persistence reveal — when the agent recalls something from 'last week,' the room goes quiet. Lean on this; build the demo around it." },
  { topic: 'demo-day-prep', source: 'rehearsal notes', type: 'episodic', importance: 0.81, minutesAgo: 720,
    content: "the entity graph slide doesn't work. people glaze. cut it from the live demo, save it for a follow-up deck if asked.",
    summary: "Cut the entity-graph slide from the live demo — audience glazes. Keep it as follow-up material for technical questions." },
  { topic: 'demo-day-prep', source: 'team chat', type: 'procedural', importance: 0.72, minutesAgo: 4320,
    content: "demo checklist: load test data on day-of, switch to demo agent, check screen mirroring, have the backup video ready, water on the podium.",
    summary: "Demo-day checklist: load test data day-of → switch to demo agent → screen mirroring check → backup video ready → water on the podium." },

  // ── hiring ──
  { topic: 'hiring', source: '1:1 with priya', type: 'episodic', importance: 0.86, minutesAgo: 360,
    content: "phone screen with james (sr backend). strong signals on systems thinking. pushed back hard on one of our design choices in a way that made us reconsider. moving to onsite.",
    summary: "James (sr backend) advancing to onsite — strong systems thinker, pushed back on a design choice in a way that made the team reconsider. Good signal." },
  { topic: 'hiring', source: 'team chat', type: 'semantic', importance: 0.77, minutesAgo: 2880,
    content: "pattern across 6 candidates this quarter: the ones who close ask about 'what's hard right now' on the first call. the ones who ghost ask about benefits.",
    summary: "Hiring pattern (6 candidates): ones who close ask 'what's hard right now' on call #1. Ones who ghost ask about benefits. Use as an early signal." },
  { topic: 'hiring', source: 'planning doc', type: 'episodic', importance: 0.55, minutesAgo: 14400,
    content: "rejected sara after onsite. great résumé but the system design round was rough. team aligned on the call.", compacted: true },

  // ── team-process ──
  { topic: 'team-process', source: 'retro notes', type: 'self_model', importance: 0.84, minutesAgo: 480,
    content: "we keep saying 'we should do shorter standups' and not doing it. third retro in a row that mentioned this. it's not a discipline problem at this point, it's a structural one.",
    summary: "'Shorter standups' has surfaced in 3 consecutive retros without action. This isn't a discipline problem; it's structural. Need a different intervention." },
  { topic: 'team-process', source: 'retro notes', type: 'semantic', importance: 0.71, minutesAgo: 2880,
    content: "noticed: the team ships best when there's exactly one person clearly accountable. when ownership is ambiguous, things drift for 2-3 weeks before someone steps in.",
    summary: "Pattern: team ships best with exactly one clearly accountable owner per project. Ambiguous ownership → 2-3 week drift before recovery. Default to single owner." },
  { topic: 'team-process', source: '1:1 with anya', type: 'episodic', importance: 0.62, minutesAgo: 7200,
    content: "anya raised the deep work problem again. afternoons are getting eaten by sync. tried 'no meetings tuesday' last quarter and it survived 3 weeks." },

  // ── design-decisions ──
  { topic: 'design-decisions', source: 'design doc', type: 'semantic', importance: 0.88, minutesAgo: 540,
    content: "API decision: every list endpoint returns paginated by default with cursor-based pagination. NOT offset. learned this the hard way last year — offset breaks under concurrent inserts.",
    summary: "API rule: list endpoints use cursor-based pagination by default, never offset. Offset breaks under concurrent inserts (learned the hard way last year)." },
  { topic: 'design-decisions', source: 'code review', type: 'semantic', importance: 0.79, minutesAgo: 2880,
    content: "naming: we use 'memory' for the noun (the thing stored), 'recall' for the verb. NOT 'memorize'/'remember'. this is across the SDK, the API, and the docs. consistency matters.",
    summary: "Naming convention (SDK + API + docs): 'memory' (noun) + 'recall' (verb). Avoid 'memorize'/'remember'. Consistency across surfaces is non-negotiable." },
  { topic: 'design-decisions', source: 'design doc', type: 'semantic', importance: 0.71, minutesAgo: 8640,
    content: "for any operation that can be expensive, we expose both a sync and async variant. the async returns a job id immediately, sync blocks. defaults to sync because most callers don't need otherwise.",
    summary: "Expensive ops: expose both sync (default — most callers) and async (returns job id) variants. Decision codified after the export-pipeline timeout incident." },
];

function memoryFrom(seed: SeedRow, idx: number): Memory {
  const createdAt = new Date(Date.now() - seed.minutesAgo * 60_000).toISOString();
  return {
    id: 10000 + idx,
    hash_id: `clude-${('0000' + idx).slice(-4)}`,
    memory_type: seed.type,
    content: seed.content,
    summary: seed.summary ?? seed.content,
    tags: [seed.topic],
    concepts: [],
    emotional_valence: 0,
    importance: seed.importance,
    access_count: Math.floor(Math.random() * 12),
    source: seed.source,
    source_id: null,
    related_user: null,
    related_wallet: null,
    metadata: {},
    created_at: createdAt,
    last_accessed: createdAt,
    decay_factor: seed.compacted ? 0.4 : Math.max(0.5, 0.99 - seed.minutesAgo / 200000),
    evidence_ids: [],
    solana_signature: null,
    compacted: seed.compacted ?? false,
    compacted_into: null,
  };
}

export const SHOWCASE_MEMORIES: Memory[] = SEED.map(memoryFrom);

// Curated contradiction: the pricing-model debate. Older = Anya per-seat,
// Newer = Seb's per-token argument.
export const SHOWCASE_CONTRADICTIONS: ContradictionPair[] = (() => {
  const aIdx = SEED.findIndex((s) => s.topic === 'pricing-model' && s.minutesAgo === 90);
  const bIdx = SEED.findIndex((s) => s.topic === 'pricing-model' && s.minutesAgo === 720);
  if (aIdx < 0 || bIdx < 0) return [];
  const a = SHOWCASE_MEMORIES[aIdx];
  const b = SHOWCASE_MEMORIES[bIdx];
  const toGraphNode = (m: Memory): GraphMemoryNode => ({
    id: m.id,
    type: m.memory_type,
    summary: m.summary,
    content: m.content,
    tags: m.tags,
    importance: m.importance,
    source: m.source,
    createdAt: m.created_at,
  });
  return [{ a: toGraphNode(a), b: toGraphNode(b), strength: 0.88 }];
})();

export const SHOWCASE_TOPIC_COUNTS: Record<string, number> = SEED.reduce((acc, s) => {
  acc[s.topic] = (acc[s.topic] ?? 0) + 1;
  return acc;
}, {} as Record<string, number>);

// Persistence stats per topic — derived from the seed's age range. Used by
// ArticleHero to show "tracked for X days · Y conversations".
export const SHOWCASE_PERSISTENCE: Record<string, { days: number; conversations: number; sources: Set<string> }> = (() => {
  const out: Record<string, { days: number; conversations: number; sources: Set<string> }> = {};
  for (const seed of SEED) {
    const days = Math.max(1, Math.round(seed.minutesAgo / 60 / 24));
    const cur = out[seed.topic] ?? { days: 0, conversations: 0, sources: new Set() };
    cur.days = Math.max(cur.days, days);
    cur.conversations += 1;
    cur.sources.add(seed.source);
    out[seed.topic] = cur;
  }
  return out;
})();
