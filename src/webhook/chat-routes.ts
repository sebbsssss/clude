/**
 * Chat API routes — memory-augmented chat with Venice AI inference.
 *
 * Supports multiple models (private via Venice infra, anonymized via third-party).
 * Auth: Cortex API key (clk_*) or Privy JWT + wallet.
 * Memory: Recalls user's memories and injects as context for each conversation turn.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { authenticateAgent, type AgentRegistration, findOrCreateAgentForWallet } from '../features/agent-tier';
import { requirePrivyAuth } from './privy-auth';
import { withOwnerWallet } from '../core/owner-context';
import { recallMemories, storeMemory } from '../core/memory';
import { checkInputContent } from '../core/guardrails';
import { checkRateLimit, getDb } from '../core/database';
import { createChildLogger } from '../core/logger';
import { config } from '../config';
import { detectTemporalConstraints, matchMemoriesTemporal } from '../experimental/temporal-bonds';
import { generateQueryEmbedding, isEmbeddingEnabled } from '../core/embeddings';

const log = createChildLogger('chat-api');

// ---- Model Registry ---- //

export const CHAT_MODELS = [
  // Private (Venice infra, zero data retention)
  { id: 'qwen3-5-9b', name: 'Qwen 3.5 9B', veniceId: 'qwen3-5-9b', privacy: 'private', context: 256000, default: true, tier: 'free' as const, cost: { input: 0, output: 0 } },
  { id: 'qwen3-next-80b', name: 'Qwen 3 Next 80B', veniceId: 'qwen3-next-80b', privacy: 'private', context: 256000, tier: 'pro' as const, cost: { input: 0.35, output: 0.35 } },
  { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', veniceId: 'llama-3.3-70b', privacy: 'private', context: 128000, tier: 'pro' as const, cost: { input: 0.20, output: 0.20 } },
  { id: 'deepseek-v3.2', name: 'DeepSeek V3.2', veniceId: 'deepseek-v3.2', privacy: 'private', context: 160000, tier: 'pro' as const, cost: { input: 0.20, output: 0.20 } },
  { id: 'mistral-31-24b', name: 'Mistral 31 24B', veniceId: 'mistral-31-24b', privacy: 'private', context: 128000, tier: 'pro' as const, cost: { input: 0.15, output: 0.15 } },
  { id: 'venice-uncensored', name: 'Venice Uncensored', veniceId: 'venice-uncensored', privacy: 'private', context: 32000, tier: 'pro' as const, cost: { input: 0.15, output: 0.15 } },
  { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', veniceId: 'kimi-k2-thinking', privacy: 'private', context: 256000, tier: 'pro' as const, cost: { input: 0.40, output: 0.40 } },
  { id: 'openai-gpt-oss-120b', name: 'GPT OSS 120B', veniceId: 'openai-gpt-oss-120b', privacy: 'private', context: 128000, tier: 'pro' as const, cost: { input: 0.50, output: 0.50 } },
  // Anonymized (third-party providers via Venice, no user identity but provider sees prompt)
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', veniceId: 'claude-sonnet-4-6', privacy: 'anonymized', context: 1000000, tier: 'pro' as const, cost: { input: 3.00, output: 15.00 } },
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', veniceId: 'claude-opus-4-6', privacy: 'anonymized', context: 1000000, tier: 'pro' as const, cost: { input: 15.00, output: 75.00 } },
  { id: 'gpt-5.4', name: 'GPT-5.4', veniceId: 'openai-gpt-54', privacy: 'anonymized', context: 1000000, tier: 'pro' as const, cost: { input: 2.00, output: 8.00 } },
  { id: 'grok-4.1-fast', name: 'Grok 4.1 Fast', veniceId: 'grok-41-fast', privacy: 'anonymized', context: 1000000, tier: 'pro' as const, cost: { input: 3.00, output: 15.00 } },
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro', veniceId: 'gemini-3-pro-preview', privacy: 'anonymized', context: 198000, tier: 'pro' as const, cost: { input: 1.25, output: 5.00 } },
];

const DEFAULT_MODEL = CHAT_MODELS.find(m => (m as any).default)?.id || 'qwen3-5-9b';

// ---- Request type ---- //

interface ChatRequest extends Request {
  ownerWallet?: string;
}

// ---- Auth middleware ---- //

async function chatAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization: Bearer <token> header' });
    return;
  }

  const token = authHeader.slice(7);

  // Cortex API key path (clk_* prefix)
  if (token.startsWith('clk_')) {
    const agent = await authenticateAgent(token);
    if (!agent) {
      res.status(401).json({ error: 'Invalid or inactive API key' });
      return;
    }

    let ownerWallet = agent.owner_wallet;
    if (!ownerWallet) {
      // Auto-assign deterministic wallet-like ID (same as cortex-routes.ts)
      ownerWallet = createHash('sha256').update(`cortex:${agent.agent_id}`).digest('hex').slice(0, 44);
      const db = getDb();
      await db.from('agent_keys').update({ owner_wallet: ownerWallet }).eq('id', agent.id);
      agent.owner_wallet = ownerWallet;
      log.info({ agentId: agent.agent_id, ownerWallet }, 'Auto-assigned owner_wallet for chat agent');
    }

    (req as ChatRequest).ownerWallet = ownerWallet;
    next();
    return;
  }

  // Privy JWT path — req.privyUser is set by optionalPrivyAuth middleware upstream
  if (req.privyUser) {
    const wallet = req.query.wallet as string;
    if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      res.status(400).json({ error: 'Valid Solana wallet address required as ?wallet= query param' });
      return;
    }
    (req as ChatRequest).ownerWallet = wallet;
    next();
    return;
  }

  res.status(401).json({ error: 'Invalid authentication token' });
}

// ---- Helpers ---- //

function buildSystemPrompt(memories: any[], opts?: { totalMemoryCount?: number; isGreeting?: boolean }): string {
  const currentDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const semantic = memories.filter(m => m.memory_type === 'semantic');
  const procedural = memories.filter(m => m.memory_type === 'procedural');
  const selfModel = memories.filter(m => m.memory_type === 'self_model');
  const episodic = memories.filter(m => m.memory_type === 'episodic' || m.memory_type === 'introspective');

  const sections: string[] = [];

  if (semantic.length > 0) {
    sections.push('<knowledge>\n' + semantic.map(m => `- ${m.summary}`).join('\n') + '\n</knowledge>');
  }
  if (procedural.length > 0) {
    sections.push('<behaviors>\n' + procedural.map(m => `- ${m.summary}`).join('\n') + '\n</behaviors>');
  }
  if (selfModel.length > 0) {
    sections.push('<identity>\n' + selfModel.map(m => `- ${m.summary}`).join('\n') + '\n</identity>');
  }
  if (episodic.length > 0) {
    sections.push('<recent>\n' + episodic.map(m => {
      const date = m.created_at ? new Date(m.created_at).toISOString().slice(0, 10) : '';
      return `- [${date}] ${m.summary}`;
    }).join('\n') + '\n</recent>');
  }

  let memoryContext: string;
  if (memories.length > 0) {
    memoryContext = `\n\nYou have recalled ${memories.length} relevant memories for this user${opts?.totalMemoryCount ? ` (out of ${opts.totalMemoryCount} total stored)` : ''}.\n\n<memories count="${memories.length}">\n${sections.join('\n')}\n</memories>`;
  } else if (opts?.totalMemoryCount && opts.totalMemoryCount > 0) {
    memoryContext = `\n\nThis user has ${opts.totalMemoryCount} stored memories, but none matched this specific query. You still know them — offer to help with anything they need.`;
  } else {
    memoryContext = `\n\nThis is a new user with no stored memories yet. Welcome them and let them know you'll remember everything from your conversations going forward.`;
  }

  if (opts?.isGreeting) {
    return `You are Clude — an AI with persistent, long-term memory. You remember everything users tell you across conversations.
Today's date is ${currentDate}.

This user just signed in. Greet them warmly and personally. If you have their memories, give a brief recap of what you remember about them and what they were last working on. Be conversational, not robotic. Don't list memories mechanically — weave them into a natural greeting. Keep it to 2-3 sentences.

Never mention Venice, infrastructure, or technical details about how you work. You ARE the memory system — you don't "query" it, you simply remember.${memoryContext}`;
  }

  return `You are Clude — an AI with persistent, long-term memory. You remember everything users tell you across conversations.
Today's date is ${currentDate}.

Use your memories naturally in conversation. Don't say "according to my records" or "I recall from my database" — just reference what you know like a person would. If a user asks about their memories, you can describe what you remember.

Never mention Venice, infrastructure providers, or technical details about how you work. Never tell users to "check Venice.ai" or any external service. You ARE the memory system.${memoryContext}`;
}

function resolveVeniceModel(modelId: string): string | null {
  const model = CHAT_MODELS.find(m => m.id === modelId);
  return model?.veniceId || null;
}

// ---- Route factory ---- //

export function chatRoutes(): Router {
  const router = Router();

  // GET /models — public, no auth
  router.get('/models', (_req: Request, res: Response) => {
    res.json(CHAT_MODELS);
  });

  // POST /guest — free tier, no auth, no memory, qwen3-5-9b only, 10 msgs/day per IP
  router.post('/guest', async (req: Request, res: Response) => {
    try {
      const { content } = req.body;
      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content is required' });
        return;
      }

      // Rate limit by IP — 10 messages per day
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const allowed = await checkRateLimit('chat:guest:' + ip, 10, 1440); // 10 per 24h
      if (!allowed) {
        res.status(429).json({
          error: 'Free limit reached. Sign in with your wallet for unlimited access.',
          requireAuth: true,
        });
        return;
      }

      // Content filter
      const contentCheck = checkInputContent(content);
      if (!contentCheck.allowed) {
        res.status(400).json({ error: 'Content rejected.', reason: contentCheck.reason });
        return;
      }

      const veniceApiKey = config.venice?.apiKey || process.env.VENICE_API_KEY;
      if (!veniceApiKey) {
        res.status(500).json({ error: 'Chat not configured' });
        return;
      }

      // Build simple messages (no memory, no conversation history)
      const messages = req.body.history || [];
      const allMessages = [
        { role: 'system', content: 'You are Clude — an AI with persistent, long-term memory. This user is not signed in yet and has limited free messages. Be helpful and naturally mention that signing in unlocks persistent memory across conversations. Never mention Venice or infrastructure details.' },
        ...messages.slice(-10), // last 10 messages from client-side history
        { role: 'user', content },
      ];

      // SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const abortController = new AbortController();
      req.on('close', () => abortController.abort());
      const veniceTimeout = setTimeout(() => abortController.abort(), 30000); // 30s max

      // Try all models in parallel — first successful response wins
      const guestModels = ['qwen3-5-9b', 'qwen3-4b', 'mistral-31-24b'];
      const modelControllers = guestModels.map(() => new AbortController());
      abortController.signal.addEventListener('abort', () => {
        modelControllers.forEach(c => c.abort());
      });

      const attempts = guestModels.map((model, i) =>
        fetch('https://api.venice.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${veniceApiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: allMessages,
            max_tokens: 2048,
            temperature: 0.7,
            stream: true,
          }),
          signal: modelControllers[i].signal,
        }).then(attempt => {
          if (!attempt.ok) {
            attempt.text().then(body => log.warn({ status: attempt.status, body, model }, 'Venice guest model unavailable')).catch(() => {});
            throw new Error(`${model}: ${attempt.status}`);
          }
          return { response: attempt, model, idx: i };
        })
      );

      let winner: { response: globalThis.Response; model: string; idx: number };
      try {
        winner = await Promise.any(attempts);
      } catch {
        log.error('All guest chat models failed');
        res.write(`data: ${JSON.stringify({ error: 'All models are currently unavailable. Please try again later.' })}\n\n`);
        res.end();
        return;
      }

      // Abort the losing requests to avoid wasting Venice credits
      modelControllers.forEach((c, i) => { if (i !== winner.idx) c.abort(); });

      const veniceRes = winner.response;
      const usedModel = winner.model;

      const reader = veniceRes.body?.getReader();
      if (!reader) { res.end(); return; }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
              }
            } catch {}
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        throw err;
      }

      // Count today's usage for this IP to compute remaining messages
      const db = getDb();
      const guestKey = 'chat:guest:' + ip;
      const windowCutoff = new Date(Date.now() - 1440 * 60 * 1000).toISOString();
      const { data: rlRow } = await db
        .from('rate_limits')
        .select('count, window_start')
        .eq('key', guestKey)
        .single();
      const usedCount = (rlRow && rlRow.window_start >= windowCutoff) ? rlRow.count : 1;
      const remaining = Math.max(0, 10 - usedCount);

      res.write(`data: ${JSON.stringify({ done: true, model: usedModel, guest: true, remaining, cost: { total: 0 } })}\n\n`);
      res.end();
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      log.error({ err }, 'Guest chat error');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Chat failed' });
      } else {
        res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
        res.end();
      }
    }
  });

  // Auto-register: create or retrieve Cortex key for a Privy-authenticated wallet
  router.post('/auto-register', requirePrivyAuth, async (req: Request, res: Response) => {
    try {
      const { wallet } = req.body;

      if (!wallet || typeof wallet !== 'string') {
        return res.status(400).json({ error: 'wallet is required' });
      }

      // Validate Solana address format
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
        return res.status(400).json({ error: 'Invalid Solana wallet address' });
      }

      const { apiKey, agentId, isNew } = await findOrCreateAgentForWallet(wallet);

      res.json({
        api_key: apiKey,
        agent_id: agentId,
        wallet,
        created: isNew,
      });
    } catch (err: any) {
      log.error({ err }, 'Auto-register failed');
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // All routes below require auth
  router.use(chatAuth);

  // POST /greet — instant personalized greeting (no LLM call — pure data)
  router.post('/greet', async (req: Request, res: Response) => {
    try {
      const chatReq = req as ChatRequest;
      const db = getDb();

      // SSE headers — send immediately so client sees connection
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // Fast parallel DB queries — no recall pipeline, no LLM
      let recentSummaries: string[] = [];
      let totalMemoryCount = 0;
      let temporalSpan: { weeks: number; since_label: string } | null = null;
      let topics: string[] = [];
      try {
        const [importantResult, countResult, oldestResult] = await Promise.all([
          // Importance-weighted sampling — best memories, not just most recent
          db.from('memories')
            .select('summary, memory_type, tags, importance')
            .eq('owner_wallet', chatReq.ownerWallet!)
            .in('memory_type', ['episodic', 'semantic'])
            .not('source', 'in', '("consolidation","compaction","reflection","emergence","contradiction_resolution","active_reflection")')
            .order('importance', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(20),
          db.from('memories')
            .select('id', { count: 'exact', head: true })
            .eq('owner_wallet', chatReq.ownerWallet!),
          // Earliest memory for temporal breadth
          db.from('memories')
            .select('created_at')
            .eq('owner_wallet', chatReq.ownerWallet!)
            .order('created_at', { ascending: true })
            .limit(1),
        ]);

        // Pick up to 3 distinct, meaningful summaries from importance-weighted results
        const seen = new Set<string>();
        const tagFreq: Record<string, number> = {};
        for (const m of importantResult.data || []) {
          const s = (m.summary || '').trim();
          if (s && !seen.has(s) && recentSummaries.length < 3) {
            seen.add(s);
            recentSummaries.push(s);
          }
          // Accumulate tag frequency for topic diversity
          for (const tag of (m.tags as string[] | null) || []) {
            if (tag && tag.length > 2) {
              tagFreq[tag] = (tagFreq[tag] || 0) + 1;
            }
          }
        }

        // Extract top 5 topics by frequency
        const SKIP_TAGS = new Set(['benchmark', 'research', 'completed', 'in-progress', 'results', 'heartbeat', 'delegation', 'episodic', 'semantic']);
        topics = Object.entries(tagFreq)
          .filter(([tag]) => !SKIP_TAGS.has(tag))
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([tag]) => tag);

        totalMemoryCount = countResult.count || 0;

        // Compute temporal span
        if (oldestResult.data?.[0]?.created_at && totalMemoryCount > 0) {
          const oldest = new Date(oldestResult.data[0].created_at);
          const now = new Date();
          const diffMs = now.getTime() - oldest.getTime();
          const diffWeeks = Math.round(diffMs / (1000 * 60 * 60 * 24 * 7));
          const since = oldest.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          temporalSpan = { weeks: diffWeeks, since_label: since };
        }
      } catch (err) {
        log.warn({ err }, 'Greeting query failed');
      }

      // Build greeting text from data — instant, no LLM needed
      let greeting: string;
      if (totalMemoryCount === 0) {
        greeting = "Welcome to Clude! I'm your AI with persistent memory — everything we talk about, I'll remember for next time. What's on your mind?";
      } else if (recentSummaries.length > 0) {
        const recapItems = recentSummaries.map(s => {
          if (s.length <= 100) return s;
          const cut = s.lastIndexOf(' ', 100);
          return s.slice(0, cut > 60 ? cut : 100) + '…';
        });
        const spanNote = temporalSpan
          ? temporalSpan.weeks <= 1
            ? ' from this week'
            : ` spanning ${temporalSpan.weeks} weeks`
          : '';
        greeting = `Hey, welcome back! I've got ${totalMemoryCount.toLocaleString()} memories loaded${spanNote}. Here's what I remember:\n\n${recapItems.map(s => `• ${s}`).join('\n')}\n\nWhat would you like to work on?`;
      } else {
        greeting = `Welcome back! I've got ${totalMemoryCount.toLocaleString()} memories loaded and ready. How can I help?`;
      }

      // Send stats + greeting as SSE (instant — no streaming needed)
      res.write(`data: ${JSON.stringify({ memories_recalled: recentSummaries.length, total_memories: totalMemoryCount })}\n\n`);
      res.write(`data: ${JSON.stringify({ content: greeting })}\n\n`);
      res.write(`data: ${JSON.stringify({
        done: true,
        memories_recalled: recentSummaries.length,
        total_memories: totalMemoryCount,
        temporal_span: temporalSpan,
        topics,
        greeting_cost: 0,
      })}\n\n`);
      res.end();
    } catch (err: any) {
      log.error({ err }, 'Greeting error');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Greeting failed' });
      } else {
        res.write(`data: ${JSON.stringify({ content: 'Hey! How can I help you today?' })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    }
  });

  // POST /conversations — create conversation
  router.post('/conversations', async (req: Request, res: Response) => {
    try {
      const chatReq = req as ChatRequest;
      const { title, model } = req.body;

      const modelId = model || DEFAULT_MODEL;
      if (!CHAT_MODELS.find(m => m.id === modelId)) {
        res.status(400).json({ error: `Unknown model: ${modelId}. Use GET /models for available models.` });
        return;
      }

      const db = getDb();
      const { data, error } = await db
        .from('chat_conversations')
        .insert({
          owner_wallet: chatReq.ownerWallet,
          title: title || null,
          model: modelId,
        })
        .select()
        .single();

      if (error) {
        log.error({ err: error }, 'Failed to create conversation');
        res.status(500).json({ error: 'Failed to create conversation' });
        return;
      }

      res.json(data);
    } catch (err) {
      log.error({ err }, 'Create conversation error');
      res.status(500).json({ error: 'Failed to create conversation' });
    }
  });

  // GET /conversations — list conversations
  router.get('/conversations', async (req: Request, res: Response) => {
    try {
      const chatReq = req as ChatRequest;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const db = getDb();
      const { data, error } = await db
        .from('chat_conversations')
        .select('*')
        .eq('owner_wallet', chatReq.ownerWallet!)
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        log.error({ err: error }, 'Failed to list conversations');
        res.status(500).json({ error: 'Failed to list conversations' });
        return;
      }

      res.json(data || []);
    } catch (err) {
      log.error({ err }, 'List conversations error');
      res.status(500).json({ error: 'Failed to list conversations' });
    }
  });

  // GET /conversations/:id — get conversation with messages
  router.get('/conversations/:id', async (req: Request, res: Response) => {
    try {
      const chatReq = req as ChatRequest;
      const conversationId = req.params.id;

      const db = getDb();

      // Fetch conversation
      const { data: conversation, error: convError } = await db
        .from('chat_conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('owner_wallet', chatReq.ownerWallet!)
        .single();

      if (convError || !conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      // Fetch messages — default last 20, supports ?before=<iso_timestamp> for pagination
      const limit = 20;
      const before = req.query.before as string | undefined;

      let msgQuery = db
        .from('chat_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit + 1); // +1 to detect whether more exist

      if (before) {
        msgQuery = msgQuery.lt('created_at', before);
      }

      const { data: msgRaw, error: msgError } = await msgQuery;

      if (msgError) {
        log.error({ err: msgError }, 'Failed to fetch messages');
        res.status(500).json({ error: 'Failed to fetch messages' });
        return;
      }

      const hasMore = (msgRaw?.length ?? 0) > limit;
      const messages = (msgRaw ?? []).slice(0, limit).reverse(); // chronological order

      res.json({ ...conversation, messages, hasMore });
    } catch (err) {
      log.error({ err }, 'Get conversation error');
      res.status(500).json({ error: 'Failed to get conversation' });
    }
  });

  // DELETE /conversations/:id — delete conversation
  router.delete('/conversations/:id', async (req: Request, res: Response) => {
    try {
      const chatReq = req as ChatRequest;
      const conversationId = req.params.id;

      const db = getDb();

      // Verify ownership
      const { data: conversation } = await db
        .from('chat_conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('owner_wallet', chatReq.ownerWallet!)
        .single();

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const { error } = await db
        .from('chat_conversations')
        .delete()
        .eq('id', conversationId);

      if (error) {
        log.error({ err: error }, 'Failed to delete conversation');
        res.status(500).json({ error: 'Failed to delete conversation' });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, 'Delete conversation error');
      res.status(500).json({ error: 'Failed to delete conversation' });
    }
  });

  // POST /conversations/:id/messages — send message (SSE streaming)
  router.post('/conversations/:id/messages', async (req: Request, res: Response) => {
    const chatReq = req as ChatRequest;
    const conversationId = req.params.id;
    const { content, model } = req.body;
    const abortController = new AbortController();
    const veniceTimeout = setTimeout(() => abortController.abort(), 45000); // 45s max

    // Handle client disconnect
    req.on('close', () => { clearTimeout(veniceTimeout); abortController.abort(); });

    try {
      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content is required (string)' });
        return;
      }

      const db = getDb();

      // 1. Validate conversation belongs to owner
      const { data: conversation } = await db
        .from('chat_conversations')
        .select('id, model')
        .eq('id', conversationId)
        .eq('owner_wallet', chatReq.ownerWallet!)
        .single();

      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      // 2. Rate limit
      const allowed = await checkRateLimit('chat:msg:' + chatReq.ownerWallet, 30, 1);
      if (!allowed) {
        res.status(429).json({ error: 'Rate limit exceeded. 30 messages per minute.' });
        return;
      }

      // 3. Content filter
      const contentCheck = checkInputContent(content);
      if (!contentCheck.allowed) {
        res.status(400).json({ error: 'Content rejected.', reason: contentCheck.reason });
        return;
      }

      // 4. Insert user message
      const { data: userMsg, error: userMsgError } = await db
        .from('chat_messages')
        .insert({
          conversation_id: conversationId,
          role: 'user',
          content,
        })
        .select('id')
        .single();

      if (userMsgError) {
        log.error({ err: userMsgError }, 'Failed to insert user message');
        res.status(500).json({ error: 'Failed to save message' });
        return;
      }

      // 5. Recall memories + get total count (with temporal awareness)
      let memories: any[] = [];
      let memoryIds: number[] = [];
      let totalMemoryCount = 0;
      const temporalConstraints = detectTemporalConstraints(content);
      if (temporalConstraints) {
        log.debug({ startDate: temporalConstraints.startDate, endDate: temporalConstraints.endDate }, 'Temporal query detected');
      }
      try {
        // Run recall, count, and optional temporal search in parallel
        const recallPromise = withOwnerWallet(chatReq.ownerWallet!, () =>
          recallMemories({ query: content, limit: 25 })
        );
        const countPromise = db.from('memories')
          .select('id', { count: 'exact', head: true })
          .eq('owner_wallet', chatReq.ownerWallet!);

        // If temporal query detected AND embeddings available, also run temporal RPC
        const temporalPromise = (temporalConstraints && isEmbeddingEnabled())
          ? generateQueryEmbedding(content).then(async (embedding) => {
              if (!embedding) return [];
              return matchMemoriesTemporal({
                queryEmbedding: embedding,
                matchThreshold: 0.3,
                matchCount: 25,
                startDate: temporalConstraints.startDate,
                endDate: temporalConstraints.endDate,
                filterOwner: chatReq.ownerWallet || null,
              });
            })
          : Promise.resolve([]);

        const [recalled, countResult, temporalResults] = await Promise.all([
          recallPromise, countPromise, temporalPromise,
        ]);

        memories = recalled;
        totalMemoryCount = countResult.count || 0;

        // Merge temporal results: fetch full records for any IDs not already in recall set
        if (temporalResults.length > 0) {
          const recalledIds = new Set(memories.map(m => m.id));
          const missingIds = temporalResults
            .map(r => r.id)
            .filter(id => !recalledIds.has(id));

          if (missingIds.length > 0) {
            const { data: temporalMemories } = await db
              .from('memories')
              .select('*')
              .in('id', missingIds)
              .eq('owner_wallet', chatReq.ownerWallet!);

            if (temporalMemories) {
              memories = [...memories, ...temporalMemories];
              log.debug({ added: temporalMemories.length }, 'Merged temporal memories into recall set');
            }
          }
        }

        memoryIds = memories.map(m => m.id);
      } catch (err) {
        log.warn({ err }, 'Memory recall failed, continuing without memories');
      }

      // 6. Load last 30 messages
      const { data: history } = await db
        .from('chat_messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(30);

      // 7. Build messages array
      const systemPrompt = buildSystemPrompt(memories, { totalMemoryCount });
      const messagesArray: Array<{ role: string; content: string }> = [
        { role: 'system', content: systemPrompt },
        ...(history || []).map(m => ({ role: m.role, content: m.content })),
      ];

      // Resolve model
      const modelId = model || conversation.model || DEFAULT_MODEL;
      const veniceModelId = resolveVeniceModel(modelId);
      if (!veniceModelId) {
        res.status(400).json({ error: `Unknown model: ${modelId}` });
        return;
      }

      const veniceApiKey = config.venice?.apiKey || process.env.VENICE_API_KEY;
      if (!veniceApiKey) {
        res.status(500).json({ error: 'Venice API not configured' });
        return;
      }

      // 8. Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // 9. Call Venice streaming API
      const veniceRes = await fetch('https://api.venice.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${veniceApiKey}`,
        },
        body: JSON.stringify({
          model: veniceModelId,
          messages: messagesArray,
          max_tokens: 4096,
          temperature: 0.7,
          stream: true,
        }),
        signal: abortController.signal,
      });

      if (!veniceRes.ok) {
        const errBody = await veniceRes.text().catch(() => 'Unknown error');
        log.error({ status: veniceRes.status, body: errBody, model: veniceModelId }, 'Venice API error');
        const isOverloaded = errBody.includes('overloaded') || veniceRes.status === 503;
        const userMsg = isOverloaded
          ? `${modelId} is currently overloaded. Try a different model.`
          : 'Model inference failed';
        res.write(`data: ${JSON.stringify({ error: userMsg, status: veniceRes.status })}\n\n`);
        res.end();
        return;
      }

      // 10. Stream response to client
      let fullContent = '';
      let tokensPrompt = 0;
      let tokensCompletion = 0;

      const reader = veniceRes.body?.getReader();
      if (!reader) {
        res.write(`data: ${JSON.stringify({ error: 'No response stream' })}\n\n`);
        res.end();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                tokensCompletion++;
                res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
              }

              // Capture usage if provided
              if (parsed.usage) {
                tokensPrompt = parsed.usage.prompt_tokens || 0;
                tokensCompletion = parsed.usage.completion_tokens || tokensCompletion;
              }
            } catch {
              // Skip malformed JSON chunks
            }
          }
        }
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // Client disconnected — clean up silently
          log.debug({ conversationId }, 'Client disconnected during streaming');
          return;
        }
        throw err;
      }

      // 11. Send done event with cost data
      const assistantMsgId = crypto.randomUUID();
      const modelDef = CHAT_MODELS.find(m => m.id === modelId);
      const costInput = modelDef ? (tokensPrompt / 1_000_000) * modelDef.cost.input : 0;
      const costOutput = modelDef ? (tokensCompletion / 1_000_000) * modelDef.cost.output : 0;
      const totalCost = costInput + costOutput;
      res.write(`data: ${JSON.stringify({
        done: true,
        message_id: assistantMsgId,
        model: modelId,
        memories_used: memoryIds.length,
        memory_ids: memoryIds,
        tokens: { prompt: tokensPrompt, completion: tokensCompletion },
        cost: { total: totalCost, input: costInput, output: costOutput },
      })}\n\n`);
      res.end();

      // 12. Insert assistant message
      await db
        .from('chat_messages')
        .insert({
          id: assistantMsgId,
          conversation_id: conversationId,
          role: 'assistant',
          content: fullContent,
          model: modelId,
          tokens_prompt: tokensPrompt || null,
          tokens_completion: tokensCompletion || null,
          memory_ids: memoryIds.length > 0 ? memoryIds : null,
        });

      // 13. Update conversation.updated_at and message_count
      await db
        .from('chat_conversations')
        .update({
          updated_at: new Date().toISOString(),
          message_count: (await db
            .from('chat_messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', conversationId)
          ).count || 0,
        })
        .eq('id', conversationId);

      // 14. Auto-generate title if null (fire-and-forget)
      autoGenerateTitle(conversationId, content, veniceApiKey).catch(err =>
        log.warn({ err, conversationId }, 'Auto-title generation failed')
      );

      // 15. Store conversation turn as full-fidelity memory (embeddings, entities, temporal)
      if (content.length > 10) {
        const memoryContent = `User said: ${content}\n\nAssistant replied: ${fullContent}`;
        const totalLen = content.length + fullContent.length;
        // Dynamic importance: substantive conversations score higher than small talk
        const importance = Math.min(0.8, 0.5 + (totalLen > 200 ? 0.1 : 0) + (totalLen > 600 ? 0.1 : 0));
        const tags = ['chat', 'conversation', `model:${modelId}`];

        Promise.resolve(
          withOwnerWallet(chatReq.ownerWallet || null, () =>
            storeMemory({
              type: 'episodic',
              content: memoryContent,
              summary: content.slice(0, 200),
              tags,
              importance,
              source: 'chat',
              sourceId: `chat:${assistantMsgId}`,
              relatedWallet: chatReq.ownerWallet,
              metadata: { conversation_id: conversationId, model: modelId },
            })
          )
        ).then(memId => {
          if (memId) log.debug({ memId, wallet: chatReq.ownerWallet?.slice(0, 8) }, 'Chat memory stored (full pipeline)');
        }).catch(err => {
          log.warn({ err }, 'Chat memory store failed');
        });
      }

    } catch (err: any) {
      if (err.name === 'AbortError') return;
      log.error({ err, conversationId }, 'Chat message error');
      // If headers haven't been sent, return JSON error
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to process message' });
      } else {
        res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
        res.end();
      }
    }
  });

  return router;
}

// ---- Auto-title generation ---- //

async function autoGenerateTitle(conversationId: string, firstMessage: string, veniceApiKey: string): Promise<void> {
  const db = getDb();

  // Check if title is already set
  const { data: conv } = await db
    .from('chat_conversations')
    .select('title')
    .eq('id', conversationId)
    .single();

  if (conv?.title) return;

  try {
    const titleRes = await fetch('https://api.venice.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${veniceApiKey}`,
      },
      body: JSON.stringify({
        model: 'qwen3-5-9b',
        messages: [
          { role: 'system', content: 'Generate a short title (max 6 words) for this conversation. Return ONLY the title, no quotes, no punctuation at the end.' },
          { role: 'user', content: firstMessage.slice(0, 500) },
        ],
        max_tokens: 30,
        temperature: 0.3,
      }),
    });

    if (titleRes.ok) {
      const titleData = await titleRes.json() as any;
      const title = titleData.choices?.[0]?.message?.content?.trim();
      if (title && title.length > 0 && title.length <= 100) {
        await db
          .from('chat_conversations')
          .update({ title })
          .eq('id', conversationId)
          .is('title', null);
      }
    }
  } catch (err) {
    log.warn({ err, conversationId }, 'Title generation request failed');
  }
}
