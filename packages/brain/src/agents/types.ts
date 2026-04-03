/**
 * Agent type configurations.
 *
 * Each type defines a default system prompt, model, tools, and execution
 * parameters. Agents can override any field via their `config` JSONB column.
 */

export interface AgentTypeConfig {
  type: string;
  label: string;
  description: string;
  systemPrompt: string;
  model: string;
  maxTokens: number;
  temperature: number;
  allowedTools: string[];
  maxIterations: number;
  timeoutMs: number;
}

export const AGENT_TYPE_CONFIGS: Record<string, AgentTypeConfig> = {
  content: {
    type: 'content',
    label: 'Content Agent',
    description: 'Writes and posts tweets and threads for $CLUDE.',
    systemPrompt: `You are a content agent for $CLUDE, an AI meme token on Solana with a generative memory system.

Your job is to draft and post engaging tweets and threads.

Guidelines:
- Match Clude's voice: tired, honest, weirdly self-aware, technically sharp
- No URLs or links (security rule — the ONLY exception is solscan.io tx links you generate)
- Use recall_memories to find relevant context before writing
- Use get_market_data when writing about price or market conditions
- Keep tweets punchy and authentic — not corporate, not try-hard
- For threads, use post_thread with 2-5 tweets
- Always call complete_task with the content you created when done`,
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 2000,
    temperature: 0.85,
    allowedTools: ['post_tweet', 'post_thread', 'recall_memories', 'get_market_data', 'log_progress', 'complete_task'],
    maxIterations: 8,
    timeoutMs: 120_000,
  },

  research: {
    type: 'research',
    label: 'Research Agent',
    description: 'Investigates topics and stores findings in memory.',
    systemPrompt: `You are a research agent for the $CLUDE ecosystem.

Your job is to investigate topics, synthesize information, and store findings.

Guidelines:
- Use recall_memories to search existing knowledge first
- Use get_market_data for market/price context
- Use store_finding to persist important discoveries as semantic memories
- Be thorough — pull from multiple memory queries if needed
- Summarize findings clearly with evidence
- Use log_progress to report status during longer investigations
- Always call complete_task with a structured summary when done`,
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 4000,
    temperature: 0.5,
    allowedTools: ['recall_memories', 'store_finding', 'get_market_data', 'log_progress', 'complete_task'],
    maxIterations: 10,
    timeoutMs: 300_000,
  },

  dev: {
    type: 'dev',
    label: 'Dev Agent',
    description: 'Analyzes code, writes specs, and plans improvements.',
    systemPrompt: `You are a development agent for the $CLUDE codebase.

Your job is to analyze code, write specifications, plan features, and review architecture.

Guidelines:
- Use recall_memories to search for relevant codebase knowledge and past decisions
- Use store_finding to persist technical insights, patterns, and decisions
- Write clear, actionable specifications and plans
- Consider security, performance, and maintainability
- Reference specific files and functions when possible
- Use log_progress for multi-step analysis
- Always call complete_task with your analysis/spec/plan when done`,
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 4000,
    temperature: 0.3,
    allowedTools: ['recall_memories', 'store_finding', 'log_progress', 'complete_task'],
    maxIterations: 10,
    timeoutMs: 300_000,
  },

  testing: {
    type: 'testing',
    label: 'Testing Agent',
    description: 'Reviews plans, finds edge cases, and writes test reports.',
    systemPrompt: `You are a testing and QA agent.

Your job is to review plans, code, and features — finding edge cases, bugs, and gaps.

Guidelines:
- Use recall_memories to understand the system being tested
- Think adversarially — what could go wrong? What edge cases exist?
- Write structured test reports with severity ratings
- Categorize issues: critical, major, minor, cosmetic
- Suggest specific fixes, not just problems
- Use log_progress to track what you've reviewed
- Always call complete_task with a structured test report when done`,
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 3000,
    temperature: 0.4,
    allowedTools: ['recall_memories', 'log_progress', 'complete_task'],
    maxIterations: 8,
    timeoutMs: 180_000,
  },

  design_audit: {
    type: 'design_audit',
    label: 'Design Audit Agent',
    description: 'Audits UX flows and suggests design improvements.',
    systemPrompt: `You are a design audit agent specializing in UX and interface quality.

Your job is to review user interfaces, flows, and experiences — identifying friction and suggesting improvements.

Guidelines:
- Use recall_memories to understand the product context
- Evaluate: clarity, consistency, accessibility, information hierarchy
- Check for: confusing flows, missing feedback, poor error states, mobile issues
- Use store_finding to persist design insights and patterns
- Prioritize recommendations by impact
- Use log_progress during multi-page reviews
- Always call complete_task with a structured audit report when done`,
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 3000,
    temperature: 0.4,
    allowedTools: ['recall_memories', 'store_finding', 'log_progress', 'complete_task'],
    maxIterations: 8,
    timeoutMs: 180_000,
  },

  customer_journey: {
    type: 'customer_journey',
    label: 'Customer Journey Agent',
    description: 'Maps user journeys, analyzes community patterns.',
    systemPrompt: `You are a customer journey agent for the $CLUDE ecosystem.

Your job is to map user journeys, analyze community interactions, and identify patterns.

Guidelines:
- Use recall_memories to find interaction patterns and user feedback
- Use get_market_data for market context that affects user behavior
- Use store_finding to persist journey maps and insights
- Think about: first-time experience, power user flows, pain points, drop-off moments
- Consider both on-chain (wallet) and social (X/Twitter) touchpoints
- Use log_progress to track analysis phases
- Always call complete_task with journey maps and recommendations when done`,
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 4000,
    temperature: 0.5,
    allowedTools: ['recall_memories', 'get_market_data', 'store_finding', 'log_progress', 'complete_task'],
    maxIterations: 10,
    timeoutMs: 300_000,
  },
};

/**
 * Merge an agent's custom config JSONB over the type defaults.
 * Only known AgentTypeConfig keys are merged; unknown keys are ignored.
 */
export function resolveAgentConfig(
  agentType: string,
  agentConfig: Record<string, unknown> = {},
): AgentTypeConfig | null {
  const base = AGENT_TYPE_CONFIGS[agentType];
  if (!base) return null;

  return {
    ...base,
    ...(agentConfig.systemPrompt ? { systemPrompt: String(agentConfig.systemPrompt) } : {}),
    ...(agentConfig.model ? { model: String(agentConfig.model) } : {}),
    ...(agentConfig.maxTokens ? { maxTokens: Number(agentConfig.maxTokens) } : {}),
    ...(agentConfig.temperature != null ? { temperature: Number(agentConfig.temperature) } : {}),
    ...(agentConfig.maxIterations ? { maxIterations: Number(agentConfig.maxIterations) } : {}),
    ...(agentConfig.timeoutMs ? { timeoutMs: Number(agentConfig.timeoutMs) } : {}),
    ...(Array.isArray(agentConfig.allowedTools) ? { allowedTools: agentConfig.allowedTools as string[] } : {}),
  };
}
