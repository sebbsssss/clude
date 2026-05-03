// Curated work-focused wiki article bodies for /showcase/wiki. Each entry
// reads like a doc you'd share with colleagues to bring them up to speed
// on a project — built up from many conversations with your agent.

import type { ProseBlock, SectionKind } from './use-topic-article';

interface CuratedSection {
  id: string;
  title: string;
  kind?: SectionKind;
  prose: ProseBlock[];
}

export interface CuratedArticle {
  topicId: string;
  sections: CuratedSection[];
}

export const SHOWCASE_ARTICLES: CuratedArticle[] = [
  {
    topicId: 'q3-roadmap',
    sections: [
      {
        id: 'commits',
        title: "What's shipping",
        kind: 'decision',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0000' }, // Q3 commits + Lina pushback
          { kind: 'p', text:
            "These three projects are the entire Q3 commitment. Anything else is explicitly **not** happening this quarter. The brain-trust feature was the hard cut and the hardest conversation; document the why so we don't relitigate it in October." },
        ],
      },
      {
        id: 'priority-filter',
        title: 'How we prioritised',
        kind: 'overview',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0001' }, // priority filter
          { kind: 'p', text:
            "The priority filter for Q3 is *what unblocks customer #1's renewal*. That single question reorders everything: [[auth-migration|auth migration]] has to land in week 3 because their security review is the gating event. Pin this filter in every planning conversation this quarter." },
        ],
      },
      {
        id: 'ownership',
        title: 'Owners',
        kind: 'action',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0002' }, // assign export to maya
          { kind: 'list', items: [
            "**Auth migration** — Ari (lead), eng-1 + eng-2 supporting",
            "**New dashboard** — Priya (lead), design embedded",
            "**Export pipeline** — Maya (lead), formalise next week per 1:1",
          ] },
          { kind: 'callout', tone: 'note', text:
            "[[team-process|Single owner per project]] is a pattern we've observed working. Don't dilute it by adding co-owners under pressure." },
        ],
      },
      {
        id: 'open',
        title: 'Open questions',
        kind: 'question',
        prose: [
          { kind: 'callout', tone: 'question', text:
            "Q2 retros flagged that we never budget for migrations and pay for it three quarters running. Are the Q3 estimates actually padded for the [[auth-migration|auth work]], or did we slip back into optimism?" },
        ],
      },
    ],
  },

  {
    topicId: 'auth-migration',
    sections: [
      {
        id: 'status',
        title: 'Where we are',
        kind: 'overview',
        prose: [
          { kind: 'p', text:
            "Migration is **in flight**. Dual-stack period started two weeks ago. We had a rollout incident this morning that's been triaged. The cookie-removal cutover gate is the JWT error rate — currently sitting around 0.08%, just over the 0.05% threshold." },
        ],
      },
      {
        id: 'plan',
        title: 'The migration plan',
        kind: 'overview',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0005' }, // dual-stack plan + cutover gate
          { kind: 'p', text:
            "We considered Stripe's 5-week parallel period but we're shipping ours in 2. That's defensible because our scale is different — but it's the kind of detail to flag when explaining the cutover risk to the board." },
        ],
      },
      {
        id: 'incidents',
        title: 'Incidents',
        kind: 'concern',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0004' }, // 2:14am incident
          { kind: 'p', text:
            "11-minute rollback. The fallback path didn't preserve `org_id` because it was reading from the wrong claim. Ari is on the postmortem; full RCA expected by Thursday. Keep this entry updated as the investigation progresses." },
        ],
      },
      {
        id: 'gotchas',
        title: 'Gotchas to remember',
        kind: 'highlight',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0006' }, // refresh token clamp
          { kind: 'callout', tone: 'note', text:
            "Two existing PRs have the same refresh-token issue. Owner of those PRs needs the heads-up before they merge — leaving it implicit means we hit this exact bug again." },
        ],
      },
    ],
  },

  {
    topicId: 'customer-research',
    sections: [
      {
        id: 'top-signal',
        title: 'The signal you can\'t ignore',
        kind: 'highlight',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0008' }, // 5 customers asking audit logs
          { kind: 'p', text:
            "When the same buy-blocker shows up five times in three weeks, it stops being feedback and starts being a roadmap input. This is the kind of pattern only the agent catches — none of us would have noticed the 5th instance was actually the 5th." },
        ],
      },
      {
        id: 'patterns',
        title: 'What people keep saying',
        kind: 'overview',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0010' }, // 14 calls breakdown
          { kind: 'reframe', memoryHash: 'clude-0009' }, // brain-trust: zero questions
          { kind: 'p', text:
            "The brain-trust silence is interesting — it informed the [[q3-roadmap|Q3 cut decision]] more than anyone realised at the time. Without persistent memory, that 6-month signal would have been one person's vague intuition rather than evidence." },
        ],
      },
      {
        id: 'how-we-listen',
        title: 'How we listen better',
        kind: 'question',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0011' }, // anya: literal asks vs underlying needs
          { kind: 'callout', tone: 'question', text:
            "Are we still treating literal customer asks as priorities? Anya's framing is that 'I want X' usually means 'I want to feel Y'. The audit-logs ask is really 'I want to feel safe deploying'. Worth re-examining last quarter's roadmap through this lens." },
        ],
      },
    ],
  },

  {
    topicId: 'pricing-model',
    sections: [
      {
        id: 'overview',
        title: 'Where we are',
        kind: 'overview',
        prose: [
          { kind: 'p', text:
            "Pricing is **not yet decided**. There's an active disagreement between per-seat and per-token. The investor pressure is to **pick one and ship** — hybrid is off the table for now. Decision needed before Friday's call." },
        ],
      },
      {
        id: 'conflict',
        title: 'Active disagreement',
        kind: 'question',
        prose: [
          { kind: 'contradiction' },
          { kind: 'p', text:
            "Anya's argument is finance-readability and predictable revenue. Seb's argument is that seats discourage adoption — every team adds 'just the people who really need it', which kills the team-level workspace value prop the [[customer-research|research]] keeps surfacing." },
        ],
      },
      {
        id: 'investor-input',
        title: 'External input',
        kind: 'overview',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0014' }, // investor: pick one
          { kind: 'callout', tone: 'note', text:
            "The 'pick one' advice is uncomfortable but right. We've been in pricing debate for six weeks without shipping. Six weeks not selling is more expensive than picking the wrong model and changing later." },
        ],
      },
    ],
  },

  {
    topicId: 'demo-day-prep',
    sections: [
      {
        id: 'works',
        title: 'What works on stage',
        kind: 'highlight',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0015' }, // persistence reveal lands
          { kind: 'p', text:
            "Build the demo around the persistence reveal. Everything else is supporting context for that one moment. The agent recalling something from 'last week' is the moment that converts skepticism into curiosity." },
        ],
      },
      {
        id: 'cut',
        title: 'What to cut',
        kind: 'concern',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0016' }, // cut entity graph slide
          { kind: 'p', text:
            "Keep the entity-graph as a follow-up artifact for technical Q&A. On stage it competes with the headline narrative." },
        ],
      },
      {
        id: 'checklist',
        title: 'Day-of checklist',
        kind: 'action',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0017' }, // demo checklist
        ],
      },
    ],
  },

  {
    topicId: 'hiring',
    sections: [
      {
        id: 'in-flight',
        title: 'In flight',
        kind: 'action',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0018' }, // james advancing to onsite
        ],
      },
      {
        id: 'patterns',
        title: 'Patterns we\'ve noticed',
        kind: 'highlight',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0019' }, // close vs ghost pattern
          { kind: 'callout', tone: 'note', text:
            "The 'asks what's hard' signal is a free, no-cost early filter. Use it on the first call to triage who's actually invested vs collecting offers. This is the kind of cross-candidate pattern only persistent memory can surface." },
        ],
      },
    ],
  },

  {
    topicId: 'team-process',
    sections: [
      {
        id: 'recurring',
        title: 'Recurring observations',
        kind: 'concern',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0021' }, // 3 retros mentioning shorter standups
          { kind: 'p', text:
            "When the same thing surfaces in three retros without action, the problem isn't that we forgot — it's that the proposed fix doesn't actually work. The honest move is to admit standup length isn't a discipline issue and try a structural change (async by default, sync only when blocked)." },
        ],
      },
      {
        id: 'works',
        title: 'What we know works',
        kind: 'highlight',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0022' }, // single owner pattern
          { kind: 'p', text:
            "Default to single ownership on every project including the [[q3-roadmap|Q3 commitments]]. Diluting ownership under pressure is the failure mode we keep falling into." },
        ],
      },
      {
        id: 'open',
        title: 'Still open',
        kind: 'question',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0023' }, // anya: deep work / no-meetings tuesday
          { kind: 'callout', tone: 'question', text:
            "No-meetings Tuesday survived 3 weeks last quarter. Is the right move to try again with stronger enforcement, or to accept that any single-day fix will erode and try something structural instead?" },
        ],
      },
    ],
  },

  {
    topicId: 'design-decisions',
    sections: [
      {
        id: 'rules',
        title: 'Standing rules',
        kind: 'decision',
        prose: [
          { kind: 'reframe', memoryHash: 'clude-0024' }, // cursor pagination
          { kind: 'reframe', memoryHash: 'clude-0025' }, // memory/recall naming
          { kind: 'reframe', memoryHash: 'clude-0026' }, // sync/async variants
        ],
      },
      {
        id: 'rationale',
        title: 'Why these rules exist',
        kind: 'overview',
        prose: [
          { kind: 'p', text:
            "Each of the rules above came from an incident, not a whiteboard. The pagination rule cost us a multi-hour outage. The naming rule was forced by a customer support thread that had to use both 'memorize' and 'remember' to get the right SDK call. Treat each as load-bearing." },
          { kind: 'callout', tone: 'note', text:
            "Persistent memory for design decisions matters more than people realise. Without it, every new engineer relitigates these from first principles in their first month." },
        ],
      },
    ],
  },
];

export function getCuratedArticle(topicId: string): CuratedArticle | null {
  return SHOWCASE_ARTICLES.find((a) => a.topicId === topicId) ?? null;
}

export interface CuratedBacklink {
  fromTopicId: string;
  snippet: string;
}

export function findCuratedBacklinks(targetTopicId: string): CuratedBacklink[] {
  const out: CuratedBacklink[] = [];
  for (const article of SHOWCASE_ARTICLES) {
    if (article.topicId === targetTopicId) continue;
    for (const section of article.sections) {
      for (const block of section.prose) {
        if (block.kind === 'p' || block.kind === 'callout') {
          if (referencesTopic(block.text, targetTopicId)) {
            out.push({
              fromTopicId: article.topicId,
              snippet: snippetAround(block.text, targetTopicId),
            });
            break;
          }
        } else if (block.kind === 'list') {
          for (const item of block.items) {
            if (referencesTopic(item, targetTopicId)) {
              out.push({
                fromTopicId: article.topicId,
                snippet: snippetAround(item, targetTopicId),
              });
              break;
            }
          }
        }
      }
    }
  }
  return out;
}

function referencesTopic(text: string, topicId: string): boolean {
  return new RegExp(`\\[\\[${topicId}(?:\\|[^\\]]+)?\\]\\]`).test(text);
}

function snippetAround(text: string, topicId: string): string {
  const plain = text
    .replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_m, slug, label) => label ?? slug)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');

  const lower = plain.toLowerCase();
  const idx = lower.indexOf(topicId.replace(/-/g, ' ')) >= 0
    ? lower.indexOf(topicId.replace(/-/g, ' '))
    : 0;
  const start = Math.max(0, idx - 60);
  const end = Math.min(plain.length, idx + 100);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < plain.length ? '…' : '';
  return `${prefix}${plain.slice(start, end).trim()}${suffix}`;
}
