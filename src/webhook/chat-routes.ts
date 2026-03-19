/**
 * Chat API routes — memory-augmented chat with Venice AI inference.
 *
 * Supports multiple models (private via Venice infra, anonymized via third-party).
 * Auth: Cortex API key (clk_*) or Privy JWT + wallet.
 * Memory: Recalls user's memories and injects as context for each conversation turn.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { authenticateAgent, type AgentRegistration } from '../features/agent-tier';
import { withOwnerWallet } from '../core/owner-context';
import { recallMemories } from '../core/memory';
import { checkInputContent } from '../core/guardrails';
import { checkRateLimit, getDb } from '../core/database';
import { createChildLogger } from '../core/logger';
import { config } from '../config';

const log = createChildLogger('chat-api');

// ---- Model Registry ---- //

export const CHAT_MODELS = [
  // Private (Venice infra, zero data retention)
  { id: 'qwen3-5-9b', name: 'Qwen 3.5 9B', veniceId: 'qwen3-5-9b', privacy: 'private', context: 256000, default: true },
  { id: 'qwen3-next-80b', name: 'Qwen 3 Next 80B', veniceId: 'qwen3-next-80b', privacy: 'private', context: 256000 },
  { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', veniceId: 'llama-3.3-70b', privacy: 'private', context: 128000 },
  { id: 'deepseek-v3.2', name: 'DeepSeek V3.2', veniceId: 'deepseek-v3.2', privacy: 'private', context: 160000 },
  { id: 'mistral-31-24b', name: 'Mistral 31 24B', veniceId: 'mistral-31-24b', privacy: 'private', context: 128000 },
  { id: 'venice-uncensored', name: 'Venice Uncensored', veniceId: 'venice-uncensored', privacy: 'private', context: 32000 },
  { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', veniceId: 'kimi-k2-thinking', privacy: 'private', context: 256000 },
  { id: 'openai-gpt-oss-120b', name: 'GPT OSS 120B', veniceId: 'openai-gpt-oss-120b', privacy: 'private', context: 128000 },
  // Anonymized (third-party providers via Venice, no user identity but provider sees prompt)
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', veniceId: 'claude-sonnet-4-6', privacy: 'anonymized', context: 1000000 },
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', veniceId: 'claude-opus-4-6', privacy: 'anonymized', context: 1000000 },
  { id: 'gpt-5.4', name: 'GPT-5.4', veniceId: 'openai-gpt-54', privacy: 'anonymized', context: 1000000 },
  { id: 'grok-4.1-fast', name: 'Grok 4.1 Fast', veniceId: 'grok-41-fast', privacy: 'anonymized', context: 1000000 },
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro', veniceId: 'gemini-3-pro-preview', privacy: 'anonymized', context: 198000 },
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

function buildSystemPrompt(memories: any[]): string {
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

  const memoryBlock = memories.length > 0
    ? `\n\n<memories count="${memories.length}">\n${sections.join('\n')}\n</memories>`
    : '';

  return `You are a helpful AI assistant with persistent memory powered by Clude.
You remember previous conversations with this user. Use the memories below naturally — don't explicitly say "I remember" unless asked.${memoryBlock}`;
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

  // All routes below require auth
  router.use(chatAuth);

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

      // Fetch last 50 messages
      const { data: messages, error: msgError } = await db
        .from('chat_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(50);

      if (msgError) {
        log.error({ err: msgError }, 'Failed to fetch messages');
        res.status(500).json({ error: 'Failed to fetch messages' });
        return;
      }

      res.json({ ...conversation, messages: messages || [] });
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

    // Handle client disconnect
    req.on('close', () => abortController.abort());

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

      // 5. Recall memories
      let memories: any[] = [];
      let memoryIds: number[] = [];
      try {
        memories = await withOwnerWallet(chatReq.ownerWallet!, () =>
          recallMemories({ query: content, limit: 10, skipExpansion: true })
        );
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
      const systemPrompt = buildSystemPrompt(memories);
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
        log.error({ status: veniceRes.status, body: errBody }, 'Venice API error');
        res.write(`data: ${JSON.stringify({ error: 'Model inference failed', status: veniceRes.status })}\n\n`);
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

      // 11. Send done event
      const assistantMsgId = crypto.randomUUID();
      res.write(`data: ${JSON.stringify({
        done: true,
        message_id: assistantMsgId,
        model: modelId,
        memories_used: memoryIds.length,
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
