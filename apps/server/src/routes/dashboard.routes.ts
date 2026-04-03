import { Router, Request, Response, NextFunction } from 'express';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import { requirePrivyAuth } from '@clude/brain/auth/privy-auth';
import { executeTaskManually, AGENT_TYPE_CONFIGS } from '@clude/brain/agents';
import { config } from '@clude/shared/config';

const log = createChildLogger('dashboard');

const CLUDE_AGENT_NAME = 'Clude';
const OWNER_WALLET = config.owner.wallet || '5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r';

/**
 * Middleware that checks if the requesting wallet is the bot owner.
 * Applied to all mutation routes (POST, PUT, DELETE, PATCH).
 * Requires requirePrivyAuth to have run first.
 */
function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const wallet = req.query.wallet as string;
  if (!wallet || wallet !== OWNER_WALLET) {
    res.status(403).json({ error: 'Owner wallet required for mutations' });
    return;
  }
  next();
}

/**
 * Auto-register the Clude bot as the first dashboard agent if not present.
 * Called on server startup.
 */
export async function autoRegisterClude(): Promise<void> {
  try {
    const db = getDb();
    const { data: existing } = await db
      .from('dashboard_agents')
      .select('id')
      .eq('name', CLUDE_AGENT_NAME)
      .eq('type', 'clude_bot')
      .limit(1)
      .single();

    if (existing) return;

    const { error } = await db.from('dashboard_agents').insert({
      name: CLUDE_AGENT_NAME,
      type: 'clude_bot',
      status: 'online',
      description: 'Autonomous AI agent on X/Twitter for $CLUDE. Stanford Generative Agents memory system.',
      config: { model: 'claude-opus-4-6', runtime: 'railway' },
      last_heartbeat_at: new Date().toISOString(),
    });

    if (error) {
      log.warn({ error: error.message }, 'Failed to auto-register Clude agent');
    } else {
      log.info('Auto-registered Clude as dashboard agent');
    }
  } catch (err) {
    log.warn({ err }, 'Could not auto-register Clude (dashboard tables may not exist yet)');
  }
}

export function dashboardRoutes(): Router {
  const router = Router();

  // All dashboard routes require Privy JWT authentication
  router.use(requirePrivyAuth);

  // ── AUTH ────────────────────────────────────────────────

  // GET /auth — verify connected wallet is the owner
  router.get('/auth', (req: Request, res: Response) => {
    const wallet = req.query.wallet as string;
    if (!wallet) {
      res.status(400).json({ error: 'wallet query parameter required' });
      return;
    }
    const authorized = wallet === OWNER_WALLET;
    res.json({
      authorized,
      wallet: wallet.slice(0, 4) + '...' + wallet.slice(-4),
    });
  });

  // ── AGENTS ──────────────────────────────────────────────

  // GET /agents — list agents scoped to the current user
  router.get('/agents', async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const wallet = req.query.wallet as string | undefined;

      // If a wallet is provided, show only agents owned by that wallet
      if (wallet) {
        const { data, error } = await db
          .from('agent_keys')
          .select('agent_id, agent_name, owner_wallet, registered_at, last_used, is_active')
          .eq('owner_wallet', wallet)
          .eq('is_active', true)
          .order('registered_at', { ascending: true });

        if (error) throw error;

        // Map to the Agent shape the dashboard expects
        res.json((data || []).map(a => ({
          id: a.agent_id,
          name: a.agent_name,
          wallet_address: a.owner_wallet,
          created_at: a.registered_at,
          last_active: a.last_used || a.registered_at,
          memory_count: 0,
        })));
        return;
      }

      // Check for cortex Bearer auth — scope to that agent's wallet
      const authHeader = req.headers['authorization'];
      if (authHeader?.startsWith('Bearer clk_')) {
        const apiKey = authHeader.slice(7);
        const { authenticateAgent } = require('@clude/brain/features/agent-tier');
        const agent = await authenticateAgent(apiKey);
        if (agent?.owner_wallet) {
          const { data, error } = await db
            .from('agent_keys')
            .select('agent_id, agent_name, owner_wallet, registered_at, last_used, is_active')
            .eq('owner_wallet', agent.owner_wallet)
            .eq('is_active', true)
            .order('registered_at', { ascending: true });

          if (error) throw error;
          res.json((data || []).map(a => ({
            id: a.agent_id,
            name: a.agent_name,
            wallet_address: a.owner_wallet,
            created_at: a.registered_at,
            last_active: a.last_used || a.registered_at,
            memory_count: 0,
          })));
          return;
        }
      }

      // Fallback: empty (no scope = no agents)
      res.json([]);
    } catch (err) {
      log.error({ err }, 'List agents error');
      res.status(500).json({ error: 'Failed to list agents' });
    }
  });

  // POST /agents — register new agent (owner only)
  router.post('/agents', requireOwner, async (req: Request, res: Response) => {
    try {
      const { name, type, description, config, heartbeat_url, heartbeat_interval_ms, budget_monthly_usd } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const db = getDb();
      const { data, error } = await db
        .from('dashboard_agents')
        .insert({
          name: name.slice(0, 100),
          type: type || 'claude_code',
          description: description ? String(description).slice(0, 500) : null,
          config: config || {},
          heartbeat_url: heartbeat_url || null,
          heartbeat_interval_ms: heartbeat_interval_ms || 300000,
          budget_monthly_usd: budget_monthly_usd || 0,
        })
        .select()
        .single();

      if (error) throw error;

      // Log activity
      await db.from('dashboard_activity').insert({
        agent_id: data.id,
        action: 'agent_registered',
        details: { name: data.name, type: data.type },
      });

      res.status(201).json(data);
    } catch (err) {
      log.error({ err }, 'Create agent error');
      res.status(500).json({ error: 'Failed to create agent' });
    }
  });

  // GET /agents/:id — get agent details (owner only)
  router.get('/agents/:id', requireOwner, async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { data, error } = await db
        .from('dashboard_agents')
        .select('*')
        .eq('id', req.params.id)
        .single();

      if (error || !data) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }
      res.json(data);
    } catch (err) {
      log.error({ err }, 'Get agent error');
      res.status(500).json({ error: 'Failed to get agent' });
    }
  });

  // PUT /agents/:id — update agent config (owner only)
  router.put('/agents/:id', requireOwner, async (req: Request, res: Response) => {
    try {
      const { name, type, description, config, heartbeat_url, heartbeat_interval_ms, budget_monthly_usd } = req.body;
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };

      if (name) updates.name = String(name).slice(0, 100);
      if (type) updates.type = type;
      if (description !== undefined) updates.description = description ? String(description).slice(0, 500) : null;
      if (config !== undefined) updates.config = config;
      if (heartbeat_url !== undefined) updates.heartbeat_url = heartbeat_url;
      if (heartbeat_interval_ms !== undefined) updates.heartbeat_interval_ms = heartbeat_interval_ms;
      if (budget_monthly_usd !== undefined) updates.budget_monthly_usd = budget_monthly_usd;

      const db = getDb();
      const { data, error } = await db
        .from('dashboard_agents')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();

      if (error || !data) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      await db.from('dashboard_activity').insert({
        agent_id: data.id,
        action: 'agent_updated',
        details: { fields: Object.keys(updates).filter(k => k !== 'updated_at') },
      });

      res.json(data);
    } catch (err) {
      log.error({ err }, 'Update agent error');
      res.status(500).json({ error: 'Failed to update agent' });
    }
  });

  // DELETE /agents/:id — remove agent (owner only)
  router.delete('/agents/:id', requireOwner, async (req: Request, res: Response) => {
    try {
      const db = getDb();

      // Log before deleting
      const { data: agent } = await db
        .from('dashboard_agents')
        .select('name')
        .eq('id', req.params.id)
        .single();

      const { error } = await db
        .from('dashboard_agents')
        .delete()
        .eq('id', req.params.id);

      if (error) throw error;

      if (agent) {
        await db.from('dashboard_activity').insert({
          agent_id: null,
          action: 'agent_removed',
          details: { name: agent.name, removed_id: req.params.id },
        });
      }

      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, 'Delete agent error');
      res.status(500).json({ error: 'Failed to delete agent' });
    }
  });

  // POST /agents/:id/heartbeat — agent heartbeat check-in
  router.post('/agents/:id/heartbeat', requireOwner, async (req: Request, res: Response) => {
    try {
      const { status, metadata, cost_usd } = req.body;
      const now = new Date().toISOString();

      const db = getDb();
      const updates: Record<string, any> = {
        last_heartbeat_at: now,
        updated_at: now,
      };
      if (status && ['online', 'offline', 'paused', 'error'].includes(status)) {
        updates.status = status;
      }

      // Accumulate cost if provided
      if (typeof cost_usd === 'number' && cost_usd > 0) {
        const { data: agent } = await db
          .from('dashboard_agents')
          .select('budget_used_usd')
          .eq('id', req.params.id)
          .single();
        if (agent) {
          updates.budget_used_usd = parseFloat(agent.budget_used_usd || '0') + cost_usd;
        }
      }

      const { data, error } = await db
        .from('dashboard_agents')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();

      if (error || !data) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      // Log heartbeat activity
      await db.from('dashboard_activity').insert({
        agent_id: data.id,
        action: 'heartbeat',
        details: metadata || {},
        cost_usd: cost_usd || 0,
      });

      res.json({ ok: true, agent: data });
    } catch (err) {
      log.error({ err }, 'Heartbeat error');
      res.status(500).json({ error: 'Heartbeat failed' });
    }
  });

  // PATCH /agents/:id/status — manually set status
  router.patch('/agents/:id/status', requireOwner, async (req: Request, res: Response) => {
    try {
      const { status } = req.body;
      if (!status || !['online', 'offline', 'paused', 'error'].includes(status)) {
        res.status(400).json({ error: 'status must be one of: online, offline, paused, error' });
        return;
      }

      const db = getDb();
      const { data, error } = await db
        .from('dashboard_agents')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select()
        .single();

      if (error || !data) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      await db.from('dashboard_activity').insert({
        agent_id: data.id,
        action: 'status_change',
        details: { new_status: status },
      });

      res.json(data);
    } catch (err) {
      log.error({ err }, 'Status change error');
      res.status(500).json({ error: 'Failed to update status' });
    }
  });

  // ── TASKS ──────────────────────────────────────────────

  // GET /tasks — list tasks (owner only)
  router.get('/tasks', requireOwner, async (req: Request, res: Response) => {
    try {
      const db = getDb();
      let query = db
        .from('dashboard_tasks')
        .select('*, dashboard_agents(id, name, type, status)')
        .order('created_at', { ascending: false });

      if (req.query.agent_id) query = query.eq('agent_id', req.query.agent_id);
      if (req.query.status) query = query.eq('status', req.query.status);
      if (req.query.priority) query = query.eq('priority', req.query.priority);

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      query = query.limit(limit);

      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (err) {
      log.error({ err }, 'List tasks error');
      res.status(500).json({ error: 'Failed to list tasks' });
    }
  });

  // POST /tasks — create task (owner only)
  router.post('/tasks', requireOwner, async (req: Request, res: Response) => {
    try {
      const { title, description, agent_id, priority, parent_task_id, metadata } = req.body;
      if (!title || typeof title !== 'string') {
        res.status(400).json({ error: 'title is required' });
        return;
      }

      const db = getDb();
      const { data, error } = await db
        .from('dashboard_tasks')
        .insert({
          title: title.slice(0, 200),
          description: description ? String(description).slice(0, 2000) : null,
          agent_id: agent_id || null,
          priority: priority || 'medium',
          parent_task_id: parent_task_id || null,
          metadata: metadata || {},
        })
        .select('*, dashboard_agents(id, name, type, status)')
        .single();

      if (error) throw error;

      await db.from('dashboard_activity').insert({
        agent_id: agent_id || null,
        action: 'task_created',
        details: { task_id: data.id, title: data.title, priority: data.priority },
      });

      res.status(201).json(data);
    } catch (err) {
      log.error({ err }, 'Create task error');
      res.status(500).json({ error: 'Failed to create task' });
    }
  });

  // PUT /tasks/:id — update task (owner only)
  router.put('/tasks/:id', requireOwner, async (req: Request, res: Response) => {
    try {
      const { title, description, status, priority, agent_id, metadata } = req.body;
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };

      if (title) updates.title = String(title).slice(0, 200);
      if (description !== undefined) updates.description = description ? String(description).slice(0, 2000) : null;
      if (status) updates.status = status;
      if (priority) updates.priority = priority;
      if (agent_id !== undefined) updates.agent_id = agent_id;
      if (metadata !== undefined) updates.metadata = metadata;

      // Set completed_at when completing
      if (status === 'completed' || status === 'failed') {
        updates.completed_at = new Date().toISOString();
      }

      const db = getDb();
      const { data, error } = await db
        .from('dashboard_tasks')
        .update(updates)
        .eq('id', req.params.id)
        .select('*, dashboard_agents(id, name, type, status)')
        .single();

      if (error || !data) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      // Log status changes
      if (status) {
        await db.from('dashboard_activity').insert({
          agent_id: data.agent_id,
          action: status === 'completed' ? 'task_completed' : status === 'in_progress' ? 'task_started' : 'task_updated',
          details: { task_id: data.id, title: data.title, status },
        });
      }

      res.json(data);
    } catch (err) {
      log.error({ err }, 'Update task error');
      res.status(500).json({ error: 'Failed to update task' });
    }
  });

  // DELETE /tasks/:id — delete task (owner only)
  router.delete('/tasks/:id', requireOwner, async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const { error } = await db
        .from('dashboard_tasks')
        .delete()
        .eq('id', req.params.id);

      if (error) throw error;
      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, 'Delete task error');
      res.status(500).json({ error: 'Failed to delete task' });
    }
  });

  // POST /tasks/:id/execute — manually trigger task execution (owner only)
  router.post('/tasks/:id/execute', requireOwner, async (req: Request, res: Response) => {
    try {
      const result = await executeTaskManually(req.params.id);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ status: 'executing', taskId: req.params.id });
    } catch (err) {
      log.error({ err }, 'Execute task error');
      res.status(500).json({ error: 'Failed to execute task' });
    }
  });

  // POST /tasks/:id/retry — retry a failed task (owner only)
  router.post('/tasks/:id/retry', requireOwner, async (req: Request, res: Response) => {
    try {
      const db = getDb();
      // Reset to pending first, then execute
      await db.from('dashboard_tasks').update({
        status: 'pending',
        updated_at: new Date().toISOString(),
      }).eq('id', req.params.id).in('status', ['failed', 'completed']);

      const result = await executeTaskManually(req.params.id);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      res.json({ status: 'executing', taskId: req.params.id });
    } catch (err) {
      log.error({ err }, 'Retry task error');
      res.status(500).json({ error: 'Failed to retry task' });
    }
  });

  // ── AGENT TYPES ──────────────────────────────────────

  // GET /agent-types — list available agent type configs for UI presets
  router.get('/agent-types', (_req: Request, res: Response) => {
    const types = Object.values(AGENT_TYPE_CONFIGS).map(c => ({
      type: c.type,
      label: c.label,
      description: c.description,
      model: c.model,
      allowedTools: c.allowedTools,
    }));
    res.json(types);
  });

  // ── ACTIVITY ──────────────────────────────────────────

  // GET /activity — activity log (owner only)
  router.get('/activity', requireOwner, async (req: Request, res: Response) => {
    try {
      const db = getDb();
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;

      let query = db
        .from('dashboard_activity')
        .select('*, dashboard_agents(id, name, type)')
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (req.query.agent_id) query = query.eq('agent_id', req.query.agent_id);
      if (req.query.action) query = query.eq('action', req.query.action);

      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (err) {
      log.error({ err }, 'Activity log error');
      res.status(500).json({ error: 'Failed to fetch activity' });
    }
  });

  // ── STATS ──────────────────────────────────────────────

  // GET /stats — aggregate dashboard stats (owner only)
  router.get('/stats', requireOwner, async (req: Request, res: Response) => {
    try {
      const db = getDb();

      const [agentsResult, tasksResult, costResult, recentActivityResult] = await Promise.all([
        db.from('dashboard_agents').select('id, status, budget_used_usd, budget_monthly_usd'),
        db.from('dashboard_tasks').select('id, status, completed_at'),
        db.from('dashboard_activity').select('cost_usd').gt('cost_usd', 0),
        db.from('dashboard_activity').select('id').gte(
          'created_at',
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        ),
      ]);

      const agents = agentsResult.data || [];
      const tasks = tasksResult.data || [];
      const costs = costResult.data || [];

      const activeAgents = agents.filter(a => a.status === 'online').length;
      const totalBudget = agents.reduce((s, a) => s + parseFloat(a.budget_monthly_usd || '0'), 0);
      const totalUsed = agents.reduce((s, a) => s + parseFloat(a.budget_used_usd || '0'), 0);
      const totalCostLogged = costs.reduce((s, c) => s + parseFloat(c.cost_usd || '0'), 0);

      // Tasks completed this week
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const completedThisWeek = tasks.filter(
        t => t.status === 'completed' && t.completed_at && t.completed_at >= weekAgo
      ).length;

      const tasksByStatus: Record<string, number> = {};
      for (const t of tasks) {
        tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1;
      }

      res.json({
        agents: {
          total: agents.length,
          active: activeAgents,
          byStatus: agents.reduce((acc, a) => {
            acc[a.status] = (acc[a.status] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
        },
        tasks: {
          total: tasks.length,
          byStatus: tasksByStatus,
          completedThisWeek,
        },
        budget: {
          totalMonthly: +totalBudget.toFixed(2),
          totalUsed: +totalUsed.toFixed(2),
          totalCostLogged: +totalCostLogged.toFixed(4),
        },
        activityLast24h: recentActivityResult.data?.length || 0,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'Stats error');
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // ── HEARTBEAT CHECKER ──────────────────────────────────

  // GET /check-heartbeats — mark stale agents as offline
  // Called periodically (cron or manual) to detect agents that stopped heartbeating
  router.post('/check-heartbeats', async (_req: Request, res: Response) => {
    try {
      const db = getDb();
      const { data: agents } = await db
        .from('dashboard_agents')
        .select('id, name, status, last_heartbeat_at, heartbeat_interval_ms')
        .in('status', ['online', 'error']);

      if (!agents || agents.length === 0) {
        res.json({ checked: 0, marked_offline: 0 });
        return;
      }

      let markedOffline = 0;
      const now = Date.now();

      for (const agent of agents) {
        if (!agent.last_heartbeat_at) continue;
        const lastBeat = new Date(agent.last_heartbeat_at).getTime();
        const threshold = (agent.heartbeat_interval_ms || 300000) * 2;

        if (now - lastBeat > threshold) {
          await db
            .from('dashboard_agents')
            .update({ status: 'offline', updated_at: new Date().toISOString() })
            .eq('id', agent.id);

          await db.from('dashboard_activity').insert({
            agent_id: agent.id,
            action: 'status_change',
            details: { new_status: 'offline', reason: 'heartbeat_timeout', previous: agent.status },
          });

          markedOffline++;
        }
      }

      res.json({ checked: agents.length, marked_offline: markedOffline });
    } catch (err) {
      log.error({ err }, 'Heartbeat check error');
      res.status(500).json({ error: 'Heartbeat check failed' });
    }
  });

  return router;
}
