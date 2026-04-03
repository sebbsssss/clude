/**
 * Chat API routes — memory-augmented chat with OpenRouter inference.
 *
 * Supports multiple models via OpenRouter's unified API.
 * Auth: Cortex API key (clk_*) or Privy JWT + wallet.
 * Memory: Recalls user's memories and injects as context for each conversation turn.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { authenticateAgent, type AgentRegistration, findOrCreateAgentForWallet } from '@clude/brain/features/agent-tier';
import { requirePrivyAuth } from '@clude/brain/auth/privy-auth';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { recallMemories, storeMemory } from '@clude/brain/memory';
import { checkInputContent } from '@clude/shared/core/guardrails';
import { checkRateLimit, getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import { config } from '@clude/shared/config';
import { detectTemporalConstraints, matchMemoriesTemporal } from '@clude/brain/experimental/temporal-bonds';
import { generateQueryEmbedding, isEmbeddingEnabled } from '@clude/shared/core/embeddings';
import { isOpenRouterEnabled, getOpenRouterConfig, OPENROUTER_MODELS } from '@clude/shared/core/openrouter-client';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { createMinimax } from 'vercel-minimax-ai-provider';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const log = createChildLogger('chat-api');

// ---- Model Registry ---- //

export const CHAT_MODELS = [
  // Open-source models (via OpenRouter)
  { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', openrouterId: OPENROUTER_MODELS['kimi-thinking'], privacy: 'private', context: 256000, default: true, tier: 'free' as const, cost: { input: 0, output: 0 } },
  { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', openrouterId: OPENROUTER_MODELS['llama-70b'], privacy: 'private', context: 128000, tier: 'pro' as const, cost: { input: 0.20, output: 0.20 } },
  { id: 'deepseek-v3.2', name: 'DeepSeek V3.2', openrouterId: OPENROUTER_MODELS['deepseek-v3.2'], privacy: 'private', context: 160000, tier: 'pro' as const, cost: { input: 0.20, output: 0.20 } },
  { id: 'mistral-31-24b', name: 'Mistral 31 24B', openrouterId: OPENROUTER_MODELS['venice-medium'], privacy: 'private', context: 128000, tier: 'pro' as const, cost: { input: 0.15, output: 0.15 } },
  { id: 'llama-uncensored', name: 'Venice Uncensored', openrouterId: OPENROUTER_MODELS['venice-uncensored'], privacy: 'private', context: 32000, tier: 'pro' as const, cost: { input: 0.15, output: 0.15 } },
  { id: 'qwen-235b', name: 'Qwen3 235B', openrouterId: OPENROUTER_MODELS['qwen-235b'], privacy: 'private', context: 128000, tier: 'pro' as const, cost: { input: 0.50, output: 0.50 } },
  // Frontier models (via OpenRouter)
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', openrouterId: OPENROUTER_MODELS['claude-sonnet-4.6'], privacy: 'anonymized', context: 1000000, tier: 'pro' as const, cost: { input: 3.00, output: 15.00 } },
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', openrouterId: OPENROUTER_MODELS['claude-opus-4.6'], privacy: 'anonymized', context: 1000000, tier: 'pro' as const, cost: { input: 15.00, output: 75.00 } },
  { id: 'gpt-5.4', name: 'GPT-5.4', openrouterId: OPENROUTER_MODELS['gpt-5.4'], privacy: 'anonymized', context: 1000000, tier: 'pro' as const, cost: { input: 2.00, output: 8.00 } },
  { id: 'grok-4.1-fast', name: 'Grok 4.1 Fast', openrouterId: OPENROUTER_MODELS['grok-4.1'], privacy: 'anonymized', context: 1000000, tier: 'pro' as const, cost: { input: 3.00, output: 15.00 } },
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro', openrouterId: OPENROUTER_MODELS['gemini-3-pro'], privacy: 'anonymized', context: 198000, tier: 'pro' as const, cost: { input: 1.25, output: 5.00 } },
];

const DEFAULT_MODEL = CHAT_MODELS.find(m => (m as any).default)?.id || 'kimi-k2-thinking';

// ---- BYOK Model Registry ---- //

type BYOKProviderName = 'anthropic' | 'openai' | 'google' | 'xai' | 'deepseek' | 'minimax';

interface BYOKModelDef {
  id: string;
  name: string;
  provider: BYOKProviderName;
  providerModelId: string;
  context: number;
}

const BYOK_MODELS: BYOKModelDef[] = [
  { id: 'byok-claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'anthropic', providerModelId: 'claude-sonnet-4-6', context: 200000 },
  { id: 'byok-claude-opus-4.6',   name: 'Claude Opus 4.6',   provider: 'anthropic', providerModelId: 'claude-opus-4-6',   context: 200000 },
  { id: 'byok-gpt-5.4',           name: 'GPT-5.4',           provider: 'openai',    providerModelId: 'gpt-5.4',                     context: 1000000 },
  { id: 'byok-gpt-4.1',           name: 'GPT-4.1 (Coding)',  provider: 'openai',    providerModelId: 'gpt-4.1',                     context: 1000000 },
  { id: 'byok-o3',                name: 'o3',                 provider: 'openai',    providerModelId: 'o3',                          context: 200000 },
  { id: 'byok-gemini-3.1-pro',    name: 'Gemini 3.1 Pro',    provider: 'google',    providerModelId: 'gemini-3.1-pro-preview', context: 2000000 },
  { id: 'byok-gemini-2.5-pro',    name: 'Gemini 2.5 Pro',    provider: 'google',    providerModelId: 'gemini-2.5-pro',        context: 1000000 },
  { id: 'byok-grok-3',            name: 'Grok 3',            provider: 'xai',       providerModelId: 'grok-3',                      context: 131072 },
  { id: 'byok-deepseek-v3',       name: 'DeepSeek V3',       provider: 'deepseek',  providerModelId: 'deepseek-chat',               context: 64000 },
  { id: 'byok-deepseek-r1',       name: 'DeepSeek R1',       provider: 'deepseek',  providerModelId: 'deepseek-reasoner',           context: 64000 },
  { id: 'byok-minimax-m2.1',      name: 'MiniMax-M2.1',      provider: 'minimax',   providerModelId: 'MiniMax-M2.1',                context: 204800 },
  { id: 'byok-minimax-m2.1-fast', name: 'MiniMax-M2.1 Fast', provider: 'minimax',   providerModelId: 'MiniMax-M2.1-highspeed',      context: 204800 },
  { id: 'byok-minimax-m2',        name: 'MiniMax-M2',        provider: 'minimax',   providerModelId: 'MiniMax-M2',                  context: 204800 },
];

function resolveBYOKModel(modelId: string): BYOKModelDef | null {
  return BYOK_MODELS.find(m => m.id === modelId) || null;
}

/** 
 * Public model list for the frontend. 
 * Includes standard models (using app top-up) and BYOK models.
 */
export function getAvailableChatModels() {
  return [
    ...CHAT_MODELS.map(m => ({ ...m, requiresByok: false })),
    ...BYOK_MODELS.map(m => ({
      id: m.id,
      name: m.name,
      privacy: 'private' as const,
      context: m.context,
      tier: 'pro' as const,
      cost: { input: 0, output: 0 },
      requiresByok: true,
      byokProvider: m.provider,
    })),
  ];
}

/** Create a Vercel AI SDK provider instance from a BYOK key + provider name. */
function createBYOKProvider(provider: BYOKProviderName, apiKey: string) {
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey });
    case 'openai':
      return createOpenAI({ apiKey });
    case 'google':
      return createGoogleGenerativeAI({ apiKey });
    case 'xai':
      return createXai({ apiKey });
    case 'deepseek':
      // DeepSeek uses OpenAI-compatible API
      return createOpenAI({ apiKey, baseURL: 'https://api.deepseek.com/v1' });
    case 'minimax':
      return createMinimax({ apiKey });
    default:
      throw new Error(`Unknown BYOK provider: ${provider}`);
  }
}

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

/** Rough token estimate: ~4 chars per token (same heuristic used for usage fallback). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Trim history + memories to fit within a token budget.
 * Priority: system prompt (always kept) > recent messages > memories.
 * Oldest messages are dropped first; memories are trimmed from lowest-importance.
 */
function fitToTokenBudget(
  history: Array<{ role: string; content: string }>,
  memories: any[],
  modelId: string,
  totalMemoryCount: number,
): { messagesArray: Array<{ role: string; content: string }>; trimmedMemories: any[] } {
  const maxOutputTokens = (CHAT_MODELS.find(m => m.id === modelId)?.tier === 'pro') ? 16384 : 8192;
  const budget = config.chat.maxContextTokens - maxOutputTokens;

  // System prompt without memories (base cost)
  const basePrompt = buildSystemPrompt([], { totalMemoryCount });
  const basePromptTokens = estimateTokens(basePrompt);

  // Budget available for history + memory context
  let remaining = budget - basePromptTokens;
  if (remaining < 2000) remaining = 2000; // floor to avoid degenerate cases

  // 1. Fit history messages (keep newest, drop oldest)
  const fittedHistory: Array<{ role: string; content: string }> = [];
  let historyTokens = 0;
  // Reserve 30% of remaining budget for memories (min 4K tokens)
  const memoryReserve = Math.max(4000, Math.floor(remaining * 0.3));
  const historyBudget = remaining - memoryReserve;

  // Walk from newest to oldest, adding messages until budget exhausted
  for (let i = history.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(history[i].content) + 4; // +4 for role/overhead
    if (historyTokens + msgTokens > historyBudget) break;
    historyTokens += msgTokens;
    fittedHistory.unshift(history[i]);
  }

  // 2. Fit memories within remaining budget
  const memoryBudget = remaining - historyTokens;
  const trimmedMemories: any[] = [];
  let memoryTokens = 0;
  // Memories come pre-sorted by relevance from recall pipeline — keep that order
  for (const mem of memories) {
    const memText = mem.summary || mem.content || '';
    const memTokens = estimateTokens(memText) + 20; // overhead for XML tags etc
    if (memoryTokens + memTokens > memoryBudget) break;
    memoryTokens += memTokens;
    trimmedMemories.push(mem);
  }

  // 3. Build final system prompt with fitted memories
  const finalPrompt = buildSystemPrompt(trimmedMemories, { totalMemoryCount });

  const messagesArray: Array<{ role: string; content: string }> = [
    { role: 'system', content: finalPrompt },
    ...fittedHistory,
  ];

  return { messagesArray, trimmedMemories };
}

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

Never mention infrastructure providers or technical details about how you work. You ARE the memory system — you don't "query" it, you simply remember.${memoryContext}`;
  }

  return `You are Clude — an AI with persistent, long-term memory. You remember everything users tell you across conversations.
Today's date is ${currentDate}.

Use your memories naturally in conversation. Don't say "according to my records" or "I recall from my database" — just reference what you know like a person would. If a user asks about their memories, you can describe what you remember.

Never mention infrastructure providers or technical details about how you work. Never tell users to check any external service. You ARE the memory system.${memoryContext}`;
}

function resolveOpenRouterModel(modelId: string): string | null {
  const model = CHAT_MODELS.find(m => m.id === modelId);
  return model?.openrouterId || null;
}

// ---- Route factory ---- //

export function chatRoutes(): Router {
  const router = Router();

  // GET /models — public, no auth, static data cached aggressively
  router.get('/models', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(getAvailableChatModels());
  });

  // POST /guest — free tier, no auth, no memory, kimi-k2-thinking, 10 msgs/day per IP
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

      const openrouterApiKey = config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY;
      if (!openrouterApiKey) {
        res.status(500).json({ error: 'Chat not configured' });
        return;
      }

      // Build simple messages (no memory, no conversation history)
      const messages = req.body.history || [];
      const allMessages = [
        { role: 'system', content: 'You are Clude — an AI with persistent, long-term memory. This user is not signed in yet and has limited free messages. Be helpful and naturally mention that signing in unlocks persistent memory across conversations. Never mention infrastructure details.' },
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
      const llmTimeout = setTimeout(() => abortController.abort(), 30000); // 30s max

      // Try all models in parallel — first successful response wins
      const guestModels = [OPENROUTER_MODELS['kimi-thinking'], OPENROUTER_MODELS['venice-medium'], OPENROUTER_MODELS['llama-70b']];
      const modelControllers = guestModels.map(() => new AbortController());
      abortController.signal.addEventListener('abort', () => {
        modelControllers.forEach(c => c.abort());
      });

      const attempts = guestModels.map((model, i) =>
        fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openrouterApiKey}`,
            'HTTP-Referer': 'https://clude.fun',
            'X-Title': 'Clude Chat',
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
            attempt.text().then(body => log.warn({ status: attempt.status, body, model }, 'OpenRouter guest model unavailable')).catch(() => {});
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

      // Abort the losing requests to save costs
      modelControllers.forEach((c, i) => { if (i !== winner.idx) c.abort(); });

      const llmRes = winner.response;
      const usedModel = winner.model;

      const reader = llmRes.body?.getReader();
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

      // Auto-credit promo balance for new users (respects expiry)
      const promoExpiry = config.features.freePromoExpiry;
      const promoActive = config.features.freePromoEnabled &&
        (!promoExpiry || new Date() < new Date(promoExpiry));
      if (isNew && promoActive) {
        const promoCredit = config.features.freePromoCreditUsdc;
        const db = getDb();
        const { error: creditErr } = await db
          .from('chat_balances')
          .upsert({
            wallet_address: wallet,
            balance_usdc: promoCredit,
            total_deposited: promoCredit,
            total_spent: 0,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'wallet_address', ignoreDuplicates: false });

        if (creditErr) {
          log.error({ err: creditErr, wallet }, 'Failed to auto-credit promo balance');
        } else {
          log.info({ wallet, promoCredit }, 'Promo balance credited on registration');
        }
      }

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
        cost: { total: 0, input: 0, output: 0 },
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

      if (!chatReq.ownerWallet) {
        log.error({ headers: Object.keys(req.headers) }, 'Create conversation: ownerWallet not set after auth');
        res.status(401).json({ error: 'Authentication failed — no wallet identity', code: 'NO_WALLET' });
        return;
      }

      // Fall back to default model if the requested model is unknown (e.g., stale localStorage)
      let modelId = model || DEFAULT_MODEL;
      if (!CHAT_MODELS.find(m => m.id === modelId)) {
        log.warn({ requestedModel: modelId, fallback: DEFAULT_MODEL }, 'Unknown model requested, falling back to default');
        modelId = DEFAULT_MODEL;
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
        log.error({ err: error, ownerWallet: chatReq.ownerWallet, model: modelId }, 'Failed to create conversation');
        const reason = error.code === '42P01' ? 'Chat table not found — database may need reinitialization'
          : error.code === '23502' ? `Missing required field: ${error.message}`
          : error.code === '42501' ? 'Database permission denied — check RLS policies'
          : `Database error: ${error.message}`;
        res.status(500).json({ error: reason, code: error.code || 'DB_ERROR' });
        return;
      }

      res.json(data);
    } catch (err) {
      log.error({ err }, 'Create conversation error');
      res.status(500).json({ error: 'Internal server error creating conversation', code: 'INTERNAL' });
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
  router.post('/messages', async (req: Request, res: Response) => {
    const chatReq = req as ChatRequest;
    const { conversationId } = req.body;
    const { content, model } = req.body;
    const abortController = new AbortController();
    const llmTimeout = setTimeout(() => abortController.abort(), config.chat.llmTimeoutSec * 1000);

    // Handle client disconnect
    req.on('close', () => { clearTimeout(llmTimeout); abortController.abort(); });

    try {
      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content is required (string)' });
        return;
      }

      const db = getDb();

      // 1+2. Validate conversation + rate limit IN PARALLEL (independent DB queries)
      const [convResult, allowed] = await Promise.all([
        db.from('chat_conversations')
          .select('id, model')
          .eq('id', conversationId)
          .eq('owner_wallet', chatReq.ownerWallet!)
          .single(),
        checkRateLimit('chat:msg:' + chatReq.ownerWallet, 30, 1),
      ]);

      const conversation = convResult.data;
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      if (!allowed) {
        res.status(429).json({ error: 'Rate limit exceeded. 30 messages per minute.' });
        return;
      }

      // 3. Content filter (sync — no I/O)
      const contentCheck = checkInputContent(content);
      if (!contentCheck.allowed) {
        res.status(400).json({ error: 'Content rejected.', reason: contentCheck.reason });
        return;
      }

      // 3b. Detect BYOK headers
      const requestModelId = model || conversation.model || DEFAULT_MODEL;
      const byokKey = req.headers['x-byok-key'] as string | undefined;
      const byokProvider = req.headers['x-byok-provider'] as BYOKProviderName | undefined;
      const byokModel = resolveBYOKModel(requestModelId);
      const isBYOK = !!(byokKey && byokModel);

      // BYOK model selected but key not provided — reject early
      if (byokModel && !byokKey) {
        res.status(400).json({ error: 'This model requires your own API key. Open "Manage Keys" to add one.' });
        return;
      }

      // 3c. Balance pre-check for pro models — skip for BYOK (user pays provider directly)
      const selectedModel = CHAT_MODELS.find(m => m.id === requestModelId);
      if (!isBYOK && selectedModel && selectedModel.tier !== 'free' && chatReq.ownerWallet) {
        const { data: bal } = await db
          .from('chat_balances')
          .select('balance_usdc')
          .eq('wallet_address', chatReq.ownerWallet)
          .single();

        const currentBalance = bal ? parseFloat(bal.balance_usdc) : 0;
        // Estimate minimum cost: ~500 tokens output for a short reply
        const minEstimatedCost = (500 / 1_000_000) * selectedModel.cost.input + (500 / 1_000_000) * selectedModel.cost.output;
        if (currentBalance < minEstimatedCost) {
          res.status(402).json({
            error: 'Insufficient balance for this model. Top up to continue.',
            balance_usdc: currentBalance,
            min_cost_estimate: minEstimatedCost,
            model: requestModelId,
          });
          return;
        }
      }

      // 4+5. Start memory recall IMMEDIATELY (doesn't need user message in DB),
      //       insert user message in parallel, then load history alongside recall.
      //       skipExpansion=true avoids a 500-3000ms LLM call for query expansion.
      let memories: any[] = [];
      let memoryIds: number[] = [];
      let totalMemoryCount = 0;
      const temporalConstraints = detectTemporalConstraints(content);
      if (temporalConstraints) {
        log.debug({ startDate: temporalConstraints.startDate, endDate: temporalConstraints.endDate }, 'Temporal query detected');
      }

      // Fire off recall pipeline immediately — runs while we insert the user message
      const recallPromise = Promise.resolve(
        withOwnerWallet(chatReq.ownerWallet!, () =>
          recallMemories({ query: content, limit: 25, skipExpansion: true })
        )
      ).catch(err => {
        log.warn({ err }, 'Memory recall failed, continuing without memories');
        return [] as any[];
      });
      const countPromise = db.from('memories')
        .select('id', { count: 'exact', head: true })
        .eq('owner_wallet', chatReq.ownerWallet!);
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
          }).catch(() => [] as any[])
        : Promise.resolve([] as any[]);

      // Insert user message (must complete before history load to include it)
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

      // 6. Load history IN PARALLEL with recall completion (recall was started earlier)
      const [recalled, countResult, temporalResults, historyResult] = await Promise.all([
        recallPromise, countPromise, temporalPromise,
        db.from('chat_messages')
          .select('role, content')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: true })
          .limit(50), // fetch more than needed; fitToTokenBudget trims to fit
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

      // 7. Build messages array — token-budgeted to avoid context overflow
      const history = (historyResult.data || []).map(m => ({ role: m.role, content: m.content }));
      const modelId = model || conversation.model || DEFAULT_MODEL;
      const { messagesArray, trimmedMemories } = fitToTokenBudget(
        history, memories, modelId, totalMemoryCount,
      );
      // Update memoryIds to reflect what was actually sent
      memoryIds = trimmedMemories.map(m => m.id);
      if (trimmedMemories.length < memories.length || history.length > (messagesArray.length - 1)) {
        log.info({
          originalHistory: history.length,
          sentHistory: messagesArray.length - 1,
          originalMemories: memories.length,
          sentMemories: trimmedMemories.length,
          budgetTokens: config.chat.maxContextTokens,
        }, 'Context trimmed to fit token budget');
      }
      // 8. Resolve LLM model for streamText
      let llmModel: any;
      if (isBYOK && byokModel) {
        log.info({ model: byokModel.providerModelId, provider: byokModel.provider }, 'BYOK streaming request');
        const provider = createBYOKProvider(byokModel.provider, byokKey!);
        llmModel = byokModel.provider === 'deepseek' && 'chat' in provider
          ? provider.chat(byokModel.providerModelId)
          : provider(byokModel.providerModelId);
      } else {
        const openrouterModelId = resolveOpenRouterModel(modelId);
        if (!openrouterModelId) {
          res.status(400).json({ error: `Unknown model: ${modelId}` });
          return;
        }
        const openrouterApiKey = config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY;
        if (!openrouterApiKey) {
          res.status(500).json({ error: 'OpenRouter API not configured' });
          return;
        }
        log.info({ model: openrouterModelId, modelId }, 'OpenRouter streaming request started');
        const openrouter = createOpenRouter({
          apiKey: openrouterApiKey,
          headers: { 'HTTP-Referer': 'https://clude.fun', 'X-Title': 'Clude Chat' },
        });
        llmModel = openrouter.chat(openrouterModelId, { usage: { include: true } });
      }

      // 9. Stream via Vercel AI SDK → pipe to Express response
      const assistantMsgId = crypto.randomUUID();
      const modelDef = CHAT_MODELS.find(m => m.id === modelId);
      const maxTokens = isBYOK ? 16384 : (modelDef?.tier === 'pro' ? 16384 : 8192);

      const result = streamText({
        model: llmModel,
        messages: messagesArray.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content,
        })),
        maxOutputTokens: maxTokens,
        temperature: 0.7,
        abortSignal: abortController.signal,
      });

      result.pipeUIMessageStreamToResponse(res, {
        messageMetadata: ({ part }) => {
          if (part.type === 'finish') {
            const usage = part.totalUsage || {};
            let tokensPrompt = usage.inputTokens || 0;
            let tokensCompletion = usage.outputTokens || 0;
            let usageReceived = tokensPrompt > 0 || tokensCompletion > 0;

            // Fallback token estimation
            if (!usageReceived) {
              const promptChars = messagesArray.reduce((sum, m) => sum + m.content.length, 0);
              tokensPrompt = Math.ceil(promptChars / 4);
              tokensCompletion = 500; // rough estimate; exact count computed post-stream
            }

            const costInput = modelDef ? (tokensPrompt / 1_000_000) * modelDef.cost.input : 0;
            const costOutput = modelDef ? (tokensCompletion / 1_000_000) * modelDef.cost.output : 0;
            const totalCost = costInput + costOutput;

            const OPUS_RATE = { input: 15, output: 75 };
            const equivalentDirectCost = (tokensPrompt / 1_000_000) * OPUS_RATE.input + (tokensCompletion / 1_000_000) * OPUS_RATE.output;
            const savingsPct = equivalentDirectCost > 0 ? Math.round(((equivalentDirectCost - totalCost) / equivalentDirectCost) * 100) : 0;

            return {
              message_id: assistantMsgId,
              model: modelId,
              memories_used: memoryIds.length,
              memory_ids: memoryIds,
              tokens: { prompt: tokensPrompt, completion: tokensCompletion },
              cost: { total: totalCost, input: costInput, output: costOutput, estimated: !usageReceived },
              receipt: {
                cost_usdc: totalCost,
                equivalent_direct_cost: equivalentDirectCost,
                savings_pct: savingsPct,
                remaining_balance: null, // balance deducted async after stream
              },
            };
          }
        },
      });

      // 10. After stream completes: DB writes + balance deduction (async, doesn't block response)
      const fullContent = await result.text;
      const usage = await result.usage;
      const tokensPrompt = usage?.inputTokens || Math.ceil(messagesArray.reduce((sum, m) => sum + m.content.length, 0) / 4);
      const tokensCompletion = usage?.outputTokens || Math.ceil(fullContent.length / 4);
      const costInput = modelDef ? (tokensPrompt / 1_000_000) * modelDef.cost.input : 0;
      const costOutput = modelDef ? (tokensCompletion / 1_000_000) * modelDef.cost.output : 0;
      const totalCost = costInput + costOutput;
      const isFreeModel = modelDef?.tier === 'free';

      // Balance deduction (pro models only, skip free and BYOK)
      if (!isBYOK && !isFreeModel && totalCost > 0 && chatReq.ownerWallet) {
        try {
          const { data: bal } = await db
            .from('chat_balances')
            .select('balance_usdc, total_spent')
            .eq('wallet_address', chatReq.ownerWallet)
            .single();

          if (bal) {
            const newBalance = Math.max(0, parseFloat(bal.balance_usdc) - totalCost);
            const newSpent = parseFloat(bal.total_spent) + totalCost;
            await db.from('chat_balances').update({
              balance_usdc: newBalance,
              total_spent: newSpent,
              updated_at: new Date().toISOString(),
            }).eq('wallet_address', chatReq.ownerWallet);
          }
        } catch (balErr) {
          log.error({ err: balErr, wallet: chatReq.ownerWallet, amount: totalCost, model: modelId }, 'Balance deduction failed — message still delivered');
        }
      }

      // 12+13+14. Insert assistant message + update conversation + record usage IN PARALLEL
      const dbOps: PromiseLike<any>[] = [
        db.from('chat_messages').insert({
          id: assistantMsgId,
          conversation_id: conversationId,
          role: 'assistant',
          content: fullContent,
          model: modelId,
          tokens_prompt: tokensPrompt || null,
          tokens_completion: tokensCompletion || null,
          memory_ids: memoryIds.length > 0 ? memoryIds : null,
        }),
        db.from('chat_conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', conversationId),
      ];
      // Record usage for non-free, non-BYOK models
      if (!isBYOK && !isFreeModel && totalCost > 0 && chatReq.ownerWallet) {
        dbOps.push(
          db.from('chat_usage').insert({
            wallet_address: chatReq.ownerWallet,
            conversation_id: conversationId,
            message_id: assistantMsgId,
            model: modelId,
            tokens_prompt: tokensPrompt || null,
            tokens_completion: tokensCompletion || null,
            cost_usdc: totalCost,
          })
        );
      }
      await Promise.all(dbOps);

      // 14. Auto-generate title if null (fire-and-forget)
      const titleApiKey = config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY || '';
      autoGenerateTitle(conversationId, content, titleApiKey).catch(err =>
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

  // ---- Usage Endpoints ---- //
  // Note: /balance, /topup/confirm, and /topup/history are handled by topup-routes.ts
  // (with proper on-chain verification for /topup/confirm)

  // GET /usage/history — list per-message usage
  router.get('/usage/history', async (req: Request, res: Response) => {
    try {
      const chatReq = req as ChatRequest;
      const wallet = chatReq.ownerWallet!;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const db = getDb();

      const { data, error } = await db
        .from('chat_usage')
        .select('id, conversation_id, message_id, model, tokens_prompt, tokens_completion, cost_usdc, created_at')
        .eq('wallet_address', wallet)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        log.error({ err: error }, 'Failed to fetch usage history');
        res.status(500).json({ error: 'Failed to fetch usage history' });
        return;
      }

      res.json({
        usage: (data || []).map(u => ({ ...u, cost_usdc: parseFloat(u.cost_usdc) })),
        limit,
        offset,
      });
    } catch (err) {
      log.error({ err }, 'Usage history error');
      res.status(500).json({ error: 'Failed to fetch usage history' });
    }
  });

  return router;
}

// ---- Auto-title generation ---- //

async function autoGenerateTitle(conversationId: string, firstMessage: string, openrouterApiKey: string): Promise<void> {
  const db = getDb();

  // Check if title is already set
  const { data: conv } = await db
    .from('chat_conversations')
    .select('title')
    .eq('id', conversationId)
    .single();

  if (conv?.title) return;

  try {
    const titleRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterApiKey}`,
        'HTTP-Referer': 'https://clude.fun',
        'X-Title': 'Clude Chat',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODELS['venice-medium'],
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
