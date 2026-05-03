// Work-focused topic taxonomy for /showcase/wiki. Reframes the page as a
// knowledge worker's wiki built from many conversations with their agent —
// the kind of context you'd share with colleagues and want to persist
// across weeks of work.

import type { Topic, Cluster } from './wiki-data';

const WORK_TOPICS: Topic[] = [
  { id: 'q3-roadmap',         name: 'Q3 Roadmap',           cluster: 'architecture' as Cluster, color: '#2244FF', count: 0,
    summary: 'What ships this quarter, what got cut, and the calls behind those decisions. The single source of truth for the team.' },
  { id: 'auth-migration',     name: 'Auth Migration',       cluster: 'architecture' as Cluster, color: '#2244FF', count: 0,
    summary: 'Moving from session cookies to JWT — incidents, fixes, and the rollback plan. Every gotcha encountered along the way.' },
  { id: 'customer-research',  name: 'Customer Research',    cluster: 'research' as Cluster,     color: '#F59E0B', count: 0,
    summary: 'Patterns surfaced across 14 customer calls. What people keep saying, what nobody asks for, what we keep mishearing.' },
  { id: 'pricing-model',      name: 'Pricing Model',        cluster: 'product' as Cluster,      color: '#10B981', count: 0,
    summary: 'Per-token vs per-seat vs hybrid. The active disagreement between Anya and Seb that needs to land before Friday.' },
  { id: 'demo-day-prep',      name: 'Demo Day Prep',        cluster: 'product' as Cluster,      color: '#10B981', count: 0,
    summary: 'What works in the live demo, what breaks, and the running checklist for the May 24 investor showcase.' },
  { id: 'hiring',             name: 'Hiring Pipeline',      cluster: 'product' as Cluster,      color: '#10B981', count: 0,
    summary: 'Candidates in flight, interview signals, and the patterns the team has noticed about who closes vs who ghosts.' },
  { id: 'team-process',       name: 'Team Process',         cluster: 'self' as Cluster,         color: '#8B5CF6', count: 0,
    summary: "How the team works — what's working, what isn't, and what we keep saying we'll change but don't." },
  { id: 'design-decisions',   name: 'Design Decisions',     cluster: 'research' as Cluster,     color: '#F59E0B', count: 0,
    summary: 'API shapes, naming choices, and the reasons behind them. Stops the "wait, why did we do it this way" conversations.' },
];

export function showcaseTopics(): Topic[] {
  return WORK_TOPICS;
}
