# Clude Bot

## gstack

Use the /browse skill from gstack for all web browsing. Never use mcp__claude-in-chrome__* tools.

Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /review, /ship, /browse, /qa, /qa-only, /design-review, /setup-browser-cookies, /retro, /investigate, /document-release, /codex, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade.

## Clude Memory (Required for ALL agents)

Clude is our product. Every agent MUST actively use it. The `clude-memory` MCP server is configured in `.mcp.json`.

**Every heartbeat / conversation, you MUST:**
1. **Store memories** about your work: decisions made, findings, blockers, task outcomes, things learned. Use `store_memory` with `source: "mcp:<your-role>"` (e.g. `mcp:ceo`, `mcp:lead-pm`, `mcp:researcher`).
2. **Recall memories** when starting work on a topic you may have context on. Use `recall_memories` before diving in.
3. **Minimum 1 memory per heartbeat** where you do meaningful work. More is better.

**Memory type guide:**
- `episodic` — events, task completions, meetings, incidents
- `semantic` — facts, knowledge, architecture decisions, team info
- `procedural` — how-to knowledge, workflows, patterns that work
- `self_model` — reflections on your own performance, strengths, gaps

**Always include:** meaningful `tags`, `importance` (0-1), and `summary`. This is our product — dogfood it seriously.

## Staging Workflow (Required)

All changes go through staging first. See `CLAUDE.md` for the full workflow.

**Key rules for all agents:**
- All PRs target `staging`, never `main`
- No direct pushes to `main` or `staging`
- Board verifies at `cludebot-test-preview.up.railway.app` before approving merge to `main`
- When shipping, always set base branch to `staging`
