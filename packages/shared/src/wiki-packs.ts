/**
 * Memory pack manifests + auto-categorisation logic.
 *
 * Lives in @clude/shared so both the brain (server-side, called from
 * storeMemory()) and the dashboard (client-side, for the topic rail)
 * can read the same definitions.
 *
 * A pack is a structured bundle that scaffolds a vertical: it declares
 * topics, section templates, and the keyword rules that route incoming
 * memories into them at store time.
 */

export type PackCluster = 'architecture' | 'research' | 'product' | 'self';

export interface PackTopicTemplate {
  id: string;
  name: string;
  cluster: PackCluster;
  color: string;
  summary: string;
  /** Optional starter section structure that empty articles render with. */
  sectionTemplates?: { id: string; title: string; kind?: string }[];
}

export interface CategorizationRule {
  /** Topic id to tag the memory with when this rule matches. */
  topicId: string;
  /**
   * Substrings searched (case-insensitive) in content + summary + tags.
   * Empty array = pack defines this topic but doesn't auto-categorise.
   */
  keywords: string[];
}

export interface MemoryPackManifest {
  id: string;
  name: string;
  vendor: string;
  vertical: string;
  version: string;
  description: string;
  installedByDefault?: boolean;
  topics: PackTopicTemplate[];
  rules: CategorizationRule[];
}

// ─────────── Pack manifests ───────────

const WORKSPACE_PACK: MemoryPackManifest = {
  id: 'workspace',
  name: 'Workspace Essentials',
  vendor: 'Clude',
  vertical: 'General',
  version: '1.0.0',
  installedByDefault: true,
  description: "The default knowledge-worker pack. Roadmaps, decisions, customer research, hiring, team process — everything you'd want a colleague to be able to skim.",
  topics: [
    { id: 'q3-roadmap',        name: 'Q3 Roadmap',        cluster: 'architecture', color: '#2244FF', summary: 'What ships this quarter, what got cut, and the calls behind those decisions.' },
    { id: 'auth-migration',    name: 'Auth Migration',    cluster: 'architecture', color: '#2244FF', summary: 'Moving from session cookies to JWT — incidents, fixes, and the rollback plan.' },
    { id: 'customer-research', name: 'Customer Research', cluster: 'research',     color: '#F59E0B', summary: 'Patterns surfaced across customer calls.' },
    { id: 'pricing-model',     name: 'Pricing Model',     cluster: 'product',      color: '#10B981', summary: 'Per-token vs per-seat — the active disagreement.' },
    { id: 'demo-day-prep',     name: 'Demo Day Prep',     cluster: 'product',      color: '#10B981', summary: 'What works in the live demo, what breaks.' },
    { id: 'hiring',            name: 'Hiring Pipeline',   cluster: 'product',      color: '#10B981', summary: 'Candidates in flight and interview-signal patterns.' },
    { id: 'team-process',      name: 'Team Process',      cluster: 'self',         color: '#8B5CF6', summary: "What's working in how the team operates and what isn't." },
    { id: 'design-decisions',  name: 'Design Decisions',  cluster: 'research',     color: '#F59E0B', summary: 'API shapes, naming choices, and the reasons behind them.' },
  ],
  rules: [
    { topicId: 'q3-roadmap',        keywords: ['roadmap', 'q3', 'quarter', 'sprint plan', 'priority'] },
    { topicId: 'auth-migration',    keywords: ['auth', 'jwt', 'session cookie', 'oauth', 'sso', 'token migration'] },
    { topicId: 'customer-research', keywords: ['customer call', 'interview', 'feedback', 'user research', 'persona'] },
    { topicId: 'pricing-model',     keywords: ['pricing', 'per-token', 'per-seat', 'subscription', 'billing tier'] },
    { topicId: 'demo-day-prep',     keywords: ['demo', 'rehearsal', 'investor', 'pitch'] },
    { topicId: 'hiring',            keywords: ['candidate', 'interview', 'hire', 'phone screen', 'onsite', 'offer'] },
    { topicId: 'team-process',      keywords: ['standup', 'retro', 'sprint', '1:1', 'process', 'team'] },
    { topicId: 'design-decisions',  keywords: ['api design', 'schema', 'naming', 'rfc', 'design doc'] },
  ],
};

const COMPLIANCE_PACK: MemoryPackManifest = {
  id: 'compliance',
  name: 'Clude Compliance',
  vendor: 'Clude',
  vertical: 'Compliance',
  version: '1.0.0',
  description: "Auto-organises every compliance-relevant decision your agents make into an audit-ready wiki. Audit logs, evidence collection, regulator asks, policy decisions — each with a cryptographic receipt anchored to Solana.",
  topics: [
    { id: 'audit-logs',          name: 'Audit Logs',           cluster: 'architecture', color: '#0EA5E9',
      summary: 'Every flagged agent action with attribution, timestamp, and a Solana-anchored hash a regulator can verify without trusting us.',
      sectionTemplates: [
        { id: 'recent-events',  title: 'Recent flagged events',  kind: 'overview'  },
        { id: 'anomalies',      title: 'Anomalies & escalations', kind: 'concern'  },
        { id: 'retention',      title: 'Retention policy',        kind: 'decision' },
      ] },
    { id: 'evidence',            name: 'Evidence Collection',  cluster: 'product',      color: '#06B6D4',
      summary: 'Documentation gathered for SOC2, HIPAA, and ISO 27001 — what we have, what we still need, and what auditors have already accepted.',
      sectionTemplates: [
        { id: 'have',     title: 'What we have',            kind: 'highlight' },
        { id: 'gaps',     title: 'Gaps to fill',            kind: 'action'    },
        { id: 'accepted', title: "What auditors accepted",   kind: 'decision' },
      ] },
    { id: 'regulator-asks',      name: 'Regulator Asks',       cluster: 'research',     color: '#F59E0B',
      summary: 'Specific requests from regulators — owner, deadline, response status. Nothing falls through the cracks.',
      sectionTemplates: [
        { id: 'open',       title: 'Open requests',     kind: 'action'  },
        { id: 'responded',  title: 'Responded',         kind: 'decision' },
        { id: 'patterns',   title: 'Recurring patterns', kind: 'highlight' },
      ] },
    { id: 'policy-decisions',    name: 'Policy Decisions',     cluster: 'self',         color: '#8B5CF6',
      summary: 'Calls made about what the agents are allowed to do — data handling, escalation triggers, redaction rules — each anchored on-chain.',
      sectionTemplates: [
        { id: 'standing',   title: 'Standing policy',   kind: 'decision' },
        { id: 'changes',    title: 'Recent changes',    kind: 'overview' },
        { id: 'open',       title: 'Open questions',    kind: 'question' },
      ] },
    { id: 'soc2-status',         name: 'SOC2 Status',          cluster: 'product',      color: '#10B981',
      summary: 'Where we are in the SOC2 audit cycle, what controls are passing, what still needs evidence.',
      sectionTemplates: [
        { id: 'controls',  title: 'Control status',  kind: 'overview' },
        { id: 'next',      title: 'Up next',         kind: 'action'   },
      ] },
  ],
  rules: [
    { topicId: 'audit-logs',       keywords: ['audit', 'audit log', 'trail', 'attribution', 'flagged'] },
    { topicId: 'evidence',         keywords: ['evidence', 'soc2', 'hipaa', 'iso 27001', 'compliance evidence', 'control'] },
    { topicId: 'regulator-asks',   keywords: ['regulator', 'subpoena', 'compliance request', 'data request'] },
    { topicId: 'policy-decisions', keywords: ['policy', 'redaction', 'pii', 'escalation rule', 'data handling'] },
    { topicId: 'soc2-status',      keywords: ['soc2', 'audit cycle', 'control test'] },
  ],
};

const SALES_PACK: MemoryPackManifest = {
  id: 'sales',
  name: 'Sales Intelligence',
  vendor: 'Clude',
  vertical: 'Sales',
  version: '1.0.0',
  description: 'Auto-organises pipeline conversations, deal blockers, objection patterns, and post-call follow-ups. Built for AEs who hate CRM data entry.',
  topics: [
    { id: 'pipeline',   name: 'Pipeline',   cluster: 'product',  color: '#10B981', summary: 'Active deals, stages, blockers.' },
    { id: 'objections', name: 'Objections', cluster: 'research', color: '#F59E0B', summary: 'Patterns across discovery calls.' },
    { id: 'follow-ups', name: 'Follow-ups', cluster: 'product',  color: '#10B981', summary: 'What you committed to send and to whom.' },
    { id: 'champions',  name: 'Champions',  cluster: 'self',     color: '#8B5CF6', summary: 'Who is championing your product internally at each account.' },
  ],
  rules: [
    { topicId: 'pipeline',   keywords: ['deal', 'opportunity', 'stage', 'close date', 'mql', 'sql'] },
    { topicId: 'objections', keywords: ['objection', 'concern raised', 'pushback', 'competitor mentioned'] },
    { topicId: 'follow-ups', keywords: ['follow up', 'send', 'next step', 'committed to'] },
    { topicId: 'champions',  keywords: ['champion', 'sponsor', 'advocate', 'introduced me to'] },
  ],
};

// ─────────── Registry ───────────

export const ALL_PACK_MANIFESTS: MemoryPackManifest[] = [
  WORKSPACE_PACK,
  COMPLIANCE_PACK,
  SALES_PACK,
];

/** Default pack — every wallet has Workspace implicitly installed. */
export const DEFAULT_PACK_ID = 'workspace';

export function getPackManifest(id: string): MemoryPackManifest | undefined {
  return ALL_PACK_MANIFESTS.find((p) => p.id === id);
}

export function packForTopicId(topicId: string): MemoryPackManifest | undefined {
  return ALL_PACK_MANIFESTS.find((p) => p.topics.some((t) => t.id === topicId));
}

// ─────────── Auto-categorisation ───────────

/**
 * Walk the rules for every installed pack and return the topic ids whose
 * keyword rules match the given memory text. Case-insensitive substring
 * match against `content + summary + tags`. Existing tags are deduped.
 *
 * Used by storeMemory() to auto-route incoming memories to the right
 * topics without requiring the caller to know which packs are installed.
 */
export function autoCategorizeTags(opts: {
  content: string;
  summary?: string;
  existingTags?: string[];
  installedPackIds: string[];
}): string[] {
  const haystack = [
    opts.content || '',
    opts.summary || '',
    ...(opts.existingTags || []),
  ].join(' ').toLowerCase();

  const matched = new Set<string>(opts.existingTags || []);

  // Always run the default pack's rules — workspace is implicitly installed.
  const ids = new Set([DEFAULT_PACK_ID, ...opts.installedPackIds]);

  for (const packId of ids) {
    const pack = getPackManifest(packId);
    if (!pack) continue;
    for (const rule of pack.rules) {
      if (matched.has(rule.topicId)) continue;
      if (rule.keywords.some((kw) => kw.length > 0 && haystack.includes(kw.toLowerCase()))) {
        matched.add(rule.topicId);
      }
    }
  }

  return Array.from(matched);
}
