/**
 * Task Executor — polls for pending dashboard tasks and executes them
 * via Claude's tool_use API.
 *
 * Pattern follows dream-cycle.ts: singleton, guard flags, timeout wrapping.
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { getDb } from '../core/database';
import { createChildLogger } from '../core/logger';
import { resolveAgentConfig, AGENT_TYPE_CONFIGS } from './types';
import { getToolSchemas, executeTool, type ToolContext, type ToolResult } from './tools';

const log = createChildLogger('task-executor');

// ── Config ──

const POLL_INTERVAL_MS = parseInt(process.env.EXECUTOR_POLL_MS || '15000', 10);
const MAX_CONCURRENT = parseInt(process.env.EXECUTOR_MAX_CONCURRENT || '2', 10);
const DEFAULT_TIMEOUT_MS = parseInt(process.env.EXECUTOR_TIMEOUT_MS || '300000', 10);

// ── Cost estimation (per 1K tokens) ──

const COST_PER_1K: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':              { input: 0.015, output: 0.075 },
  'claude-sonnet-4-5-20250929':   { input: 0.003, output: 0.015 },
};

function estimateCost(model: string, usage: { input_tokens: number; output_tokens: number }): number {
  const rates = COST_PER_1K[model] || COST_PER_1K['claude-sonnet-4-5-20250929'];
  return (usage.input_tokens / 1000) * rates.input + (usage.output_tokens / 1000) * rates.output;
}

// ── Singleton state ──

let pollTimer: ReturnType<typeof setInterval> | null = null;
const running = new Map<string, Promise<void>>();

// ── Anthropic client (separate from bot's personality-injected client) ──

let anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropic) {
    if (!config.anthropic.apiKey) throw new Error('ANTHROPIC_API_KEY required for task executor');
    anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
  }
  return anthropic;
}

// ── Start / Stop ──

export function startTaskExecutor(): void {
  if (pollTimer) return;

  // Check if any agent types exist that we can execute
  const knownTypes = Object.keys(AGENT_TYPE_CONFIGS);
  log.info({ knownTypes, pollMs: POLL_INTERVAL_MS, maxConcurrent: MAX_CONCURRENT }, 'Task executor starting');

  poll().catch(err => log.error({ err }, 'Initial poll failed'));
  pollTimer = setInterval(() => {
    poll().catch(err => log.error({ err }, 'Poll cycle failed'));
  }, POLL_INTERVAL_MS);
}

export function stopTaskExecutor(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  log.info({ inflight: running.size }, 'Task executor stopped');
}

// ── Poll for pending tasks ──

async function poll(): Promise<void> {
  if (running.size >= MAX_CONCURRENT) return;

  const db = getDb();
  const slots = MAX_CONCURRENT - running.size;

  // Query for pending tasks with an assigned online agent of a known type
  const knownTypes = Object.keys(AGENT_TYPE_CONFIGS);
  const { data: tasks, error } = await db
    .from('dashboard_tasks')
    .select('id, title, description, priority, metadata, agent_id, created_at')
    .eq('status', 'pending')
    .not('agent_id', 'is', null)
    .order('priority', { ascending: true })  // critical(0) → low(3) via DB sort
    .order('created_at', { ascending: true })
    .limit(slots + 2);  // fetch a few extra in case some fail to claim

  if (error) {
    log.error({ error: error.message }, 'Failed to query pending tasks');
    return;
  }
  if (!tasks || tasks.length === 0) return;

  for (const task of tasks) {
    if (running.size >= MAX_CONCURRENT) break;
    if (running.has(task.id)) continue;

    // Fetch the agent to check type and status
    const { data: agent } = await db
      .from('dashboard_agents')
      .select('id, name, type, config, status')
      .eq('id', task.agent_id)
      .single();

    if (!agent || agent.status !== 'online' || !knownTypes.includes(agent.type)) continue;

    // Claim atomically
    const { data: claimed, error: claimErr } = await db
      .from('dashboard_tasks')
      .update({ status: 'in_progress', updated_at: new Date().toISOString() })
      .eq('id', task.id)
      .eq('status', 'pending')
      .select('id')
      .single();

    if (claimErr || !claimed) continue;

    log.info({ taskId: task.id, agentName: agent.name, agentType: agent.type }, 'Claimed task');

    // Log activity
    await db.from('dashboard_activity').insert({
      agent_id: agent.id,
      action: 'task_started',
      details: { task_id: task.id, title: task.title },
    });

    // Execute (fire and forget, tracked in running map)
    const promise = executeTask(task, agent)
      .catch(err => log.error({ err, taskId: task.id }, 'Task execution crashed'))
      .finally(() => running.delete(task.id));

    running.set(task.id, promise);
  }
}

// ── Execute a single task via Claude tool_use loop ──

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  metadata: Record<string, unknown> | null;
  agent_id: string;
  created_at: string;
}

interface AgentRow {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown> | null;
  status: string;
}

async function executeTask(task: TaskRow, agent: AgentRow): Promise<void> {
  const agentConfig = resolveAgentConfig(agent.type, agent.config || {});
  if (!agentConfig) {
    await failTask(task.id, agent.id, `Unknown agent type: ${agent.type}`);
    return;
  }

  const timeoutMs = agentConfig.timeoutMs || DEFAULT_TIMEOUT_MS;
  const startTime = Date.now();
  const executionLog: string[] = [];

  const logEntry = (msg: string) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    executionLog.push(`[${elapsed}s] ${msg}`);
  };

  logEntry(`Starting: ${agent.name} (${agent.type})`);

  const ctx: ToolContext = {
    taskId: task.id,
    agentId: agent.id,
    agentName: agent.name,
  };

  const tools = getToolSchemas(agentConfig.allowedTools);
  const client = getAnthropicClient();

  // Build initial messages
  const userContent = [
    `## Task: ${task.title}`,
    task.description ? `\n${task.description}` : '',
    `\nPriority: ${task.priority}`,
    task.metadata?.input ? `\nAdditional context:\n${JSON.stringify(task.metadata.input)}` : '',
  ].filter(Boolean).join('');

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userContent },
  ];

  let totalCost = 0;
  let completionData: Record<string, unknown> | null = null;
  let lastText = '';

  try {
    // Tool use loop with timeout
    await Promise.race([
      (async () => {
        for (let i = 0; i < agentConfig.maxIterations; i++) {
          logEntry(`Iteration ${i + 1}/${agentConfig.maxIterations}`);

          const response = await client.messages.create({
            model: agentConfig.model,
            max_tokens: agentConfig.maxTokens,
            temperature: agentConfig.temperature,
            system: agentConfig.systemPrompt,
            tools,
            messages,
          });

          // Track cost
          if (response.usage) {
            totalCost += estimateCost(agentConfig.model, response.usage);
          }

          // Process response content blocks
          const assistantContent: Anthropic.ContentBlock[] = response.content;
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          let terminated = false;

          for (const block of assistantContent) {
            if (block.type === 'text') {
              lastText = block.text;
            } else if (block.type === 'tool_use') {
              logEntry(`Tool: ${block.name}(${JSON.stringify(block.input).slice(0, 100)})`);

              const result: ToolResult = await executeTool(
                block.name,
                block.input as Record<string, unknown>,
                ctx,
              );

              logEntry(`  → ${result.success ? 'OK' : 'FAIL'}: ${result.output.slice(0, 100)}`);

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result.output,
              });

              if (result.terminate) {
                terminated = true;
                completionData = result.data || null;
              }
            }
          }

          // If no tool calls, we're done
          if (response.stop_reason === 'end_turn' && toolResults.length === 0) {
            logEntry('Agent finished (end_turn, no tool calls)');
            // Use the text as a fallback result
            if (!completionData && lastText) {
              completionData = { result: lastText, summary: lastText.slice(0, 500) };
            }
            break;
          }

          // Append assistant message + tool results
          messages.push({ role: 'assistant', content: assistantContent });
          if (toolResults.length > 0) {
            messages.push({ role: 'user', content: toolResults });
          }

          if (terminated) {
            logEntry('Task completed via complete_task');
            break;
          }
        }
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Execution timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);

    // Success
    logEntry(`Done. Cost: $${totalCost.toFixed(4)}`);

    const db = getDb();
    const cd = completionData as Record<string, unknown> | null;
    const cResult = String(cd?.['result'] || lastText || '(no output)');
    const cSummary = String(cd?.['summary'] || (lastText || '').slice(0, 500));

    const resultMeta = {
      ...(task.metadata || {}),
      result: cResult,
      summary: cSummary,
      execution_log: executionLog,
      iterations: messages.filter(m => m.role === 'assistant').length,
      model: agentConfig.model,
      cost_usd: +totalCost.toFixed(4),
      ...(completionData || {}),
    };

    await db.from('dashboard_tasks').update({
      status: 'completed',
      metadata: resultMeta,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', task.id);

    // Log completion activity
    await db.from('dashboard_activity').insert({
      agent_id: agent.id,
      action: 'task_completed',
      details: { task_id: task.id, title: task.title, summary: cSummary },
      cost_usd: totalCost,
    });

    // Update agent budget
    const { data: agentData } = await db
      .from('dashboard_agents')
      .select('budget_used_usd')
      .eq('id', agent.id)
      .single();
    if (agentData) {
      await db.from('dashboard_agents').update({
        budget_used_usd: parseFloat(agentData.budget_used_usd || '0') + totalCost,
        updated_at: new Date().toISOString(),
      }).eq('id', agent.id);
    }

    log.info({ taskId: task.id, cost: totalCost.toFixed(4), iterations: resultMeta.iterations }, 'Task completed');

  } catch (err: any) {
    logEntry(`FAILED: ${err.message}`);
    await failTask(task.id, agent.id, err.message, executionLog, totalCost);
  }
}

async function failTask(
  taskId: string,
  agentId: string,
  error: string,
  executionLog: string[] = [],
  cost = 0,
): Promise<void> {
  const db = getDb();

  await db.from('dashboard_tasks').update({
    status: 'failed',
    metadata: { error, execution_log: executionLog, cost_usd: +cost.toFixed(4) },
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', taskId);

  await db.from('dashboard_activity').insert({
    agent_id: agentId,
    action: 'task_failed',
    details: { task_id: taskId, error },
    cost_usd: cost,
  });

  log.warn({ taskId, error }, 'Task failed');
}

/**
 * Manually trigger execution of a specific task.
 * Returns immediately — execution runs in background.
 */
export async function executeTaskManually(taskId: string): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();

  // Fetch task
  const { data: task, error: taskErr } = await db
    .from('dashboard_tasks')
    .select('id, title, description, priority, metadata, agent_id, created_at')
    .eq('id', taskId)
    .single();

  if (taskErr || !task) return { ok: false, error: 'Task not found' };
  if (!task.agent_id) return { ok: false, error: 'Task has no assigned agent' };
  if (running.has(task.id)) return { ok: false, error: 'Task is already running' };

  // Fetch agent
  const { data: agent } = await db
    .from('dashboard_agents')
    .select('id, name, type, config, status')
    .eq('id', task.agent_id)
    .single();

  if (!agent) return { ok: false, error: 'Agent not found' };
  if (!AGENT_TYPE_CONFIGS[agent.type]) return { ok: false, error: `Unknown agent type: ${agent.type}` };

  // Claim
  const { error: claimErr } = await db
    .from('dashboard_tasks')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .in('status', ['pending', 'failed']);

  if (claimErr) return { ok: false, error: 'Failed to claim task' };

  // Log activity
  await db.from('dashboard_activity').insert({
    agent_id: agent.id,
    action: 'task_started',
    details: { task_id: task.id, title: task.title, manual: true },
  });

  // Execute in background
  const promise = executeTask(task, agent)
    .catch(err => log.error({ err, taskId }, 'Manual task execution crashed'))
    .finally(() => running.delete(taskId));

  running.set(taskId, promise);

  return { ok: true };
}
