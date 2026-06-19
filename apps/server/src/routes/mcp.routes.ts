/**
 * Remote MCP Connector — Streamable HTTP transport.
 *
 * This is the endpoint Claude Desktop / claude.ai connect to as a "custom
 * connector" or (once submitted) a featured directory connector. It speaks
 * the MCP Streamable HTTP transport spec and exposes a curated subset of
 * Clude's memory tools.
 *
 * Auth: `Authorization: Bearer <api_key>` using the same agent_keys API key
 * users already get from /api/cortex/register. OAuth 2.1 discovery endpoints
 * are exposed for forward-compat (see well-known handlers in app.ts), but
 * v1 ships with bearer-token auth — Claude Desktop's custom-connector flow
 * accepts a fixed header.
 *
 * Transport: stateless. One transport per request, no session state. Safe
 * for Railway's multi-instance deployment without sticky sessions.
 */
import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { authenticateAgent, recordAgentInteraction } from '@clude/brain/features/agent-tier';
import { verifyAccessToken as verifyOAuthAccessToken } from '../oauth/core.js';
import { getDb } from '@clude/shared/core/database';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import {
  storeMemory,
  recallMemories,
  getMemoryStats,
  type MemoryType,
} from '@clude/brain/memory';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('mcp-connector');

const MEMORY_TYPES = ['episodic', 'semantic', 'procedural', 'self_model', 'introspective'] as const;

const SERVER_INFO = {
  name: 'clude',
  title: 'Clude — Persistent Memory',
  version: '1.0.0',
};

function buildServerForOwner(ownerWallet: string, agentId: string, scope: string): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.tool(
    'recall_memories',
    'Search the user\'s persistent memory. Returns scored memories ranked by relevance, importance, recency, and decay. Call this whenever the user references past conversations, projects, people, or decisions.',
    {
      query: z.string().optional().describe('Text to search against memory summaries and content'),
      tags: z.array(z.string()).optional().describe('Tags to filter by (matches any)'),
      memory_types: z.array(z.enum(MEMORY_TYPES)).optional().describe('Filter by memory type'),
      limit: z.number().min(1).max(50).optional().describe('Max results (default 10, max 50)'),
      min_importance: z.number().min(0).max(1).optional().describe('Minimum importance threshold'),
    },
    {
      title: 'Recall memories',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async (args) => {
      try {
        const memories = await withOwnerWallet(ownerWallet, async () =>
          recallMemories({
            query: args.query,
            tags: args.tags,
            memoryTypes: args.memory_types as MemoryType[] | undefined,
            limit: Math.min(args.limit ?? 10, 50),
            minImportance: args.min_importance,
          }),
        );
        recordAgentInteraction(agentId).catch((err) => log.warn({ err }, 'recordAgentInteraction failed'));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              count: memories.length,
              memories: memories.map((m: any) => ({
                id: m.id,
                type: m.memory_type,
                summary: m.summary,
                content: m.content,
                tags: m.tags ?? [],
                importance: m.importance,
                created_at: m.created_at,
              })),
            }),
          }],
        };
      } catch (err: any) {
        log.error({ err }, 'recall_memories failed');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? 'recall failed' }) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'store_memory',
    'Save a new memory to the user\'s persistent store. Use this when you learn something durable about the user — preferences, decisions, project state, key facts — that should survive across conversations.',
    {
      type: z.enum(MEMORY_TYPES).describe('episodic (events), semantic (facts), procedural (how-to), self_model (about-the-user), introspective (reflection)'),
      content: z.string().max(5000).describe('Full memory text'),
      summary: z.string().max(500).describe('Short summary used for recall matching'),
      tags: z.array(z.string()).optional().describe('Tags for filtering'),
      importance: z.number().min(0).max(1).optional().describe('Importance 0-1 (auto-scored if omitted)'),
      source: z.string().optional().describe('Where this came from (default: "mcp:claude-desktop")'),
    },
    {
      title: 'Store memory',
      readOnlyHint: false,
      // Anthropic directory review expects write tools to set destructiveHint so
      // Claude prompts before persisting. store_memory creates durable records;
      // a missing/false write annotation is the single most common rejection cause.
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    async (args) => {
      try {
        if (!scope.split(' ').includes('memory:write')) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: 'insufficient_scope: memory:write required' }) }],
            isError: true,
          };
        }
        const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').trim();
        const memoryId = await withOwnerWallet(ownerWallet, async () =>
          storeMemory({
            type: args.type as MemoryType,
            content: stripHtml(args.content),
            summary: stripHtml(args.summary),
            tags: args.tags ?? [],
            importance: args.importance,
            source: args.source ?? 'mcp:claude-desktop',
          }),
        );
        recordAgentInteraction(agentId).catch((err) => log.warn({ err }, 'recordAgentInteraction failed'));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ stored: memoryId !== null, memory_id: memoryId }),
          }],
        };
      } catch (err: any) {
        log.error({ err }, 'store_memory failed');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? 'store failed' }) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'get_memory_stats',
    'Get high-level stats about the user\'s memory: counts by type, average importance, top tags. Useful for confirming the memory system is active.',
    {},
    {
      title: 'Memory stats',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async () => {
      try {
        const stats = await withOwnerWallet(ownerWallet, async () => getMemoryStats());
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(stats) }],
        };
      } catch (err: any) {
        log.error({ err }, 'get_memory_stats failed');
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: err.message ?? 'stats failed' }) }],
          isError: true,
        };
      }
    },
  );

  return server;
}

interface McpAuth {
  ownerWallet: string;
  agentId: string;
  scope: string;
}

async function authFromBearer(authHeader: string | undefined): Promise<McpAuth | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  // 1) OAuth 2.1 access token (JWT). verifyOAuthAccessToken returns null when OAuth is
  //    disabled or the token isn't ours, so we transparently fall through to API keys.
  const claims = await verifyOAuthAccessToken(token);
  if (claims) {
    return { ownerWallet: claims.sub, agentId: `oauth:${claims.clientId || 'client'}`, scope: claims.scope };
  }

  // 2) Legacy Clude API key (clk_…) — kept working for existing SDK users.
  const agent = await authenticateAgent(token);
  if (!agent) return null;
  let ownerWallet = agent.owner_wallet;
  if (!ownerWallet) {
    // Auto-assign a deterministic wallet-like ID, mirroring cortexAuth
    ownerWallet = createHash('sha256').update(`cortex:${agent.agent_id}`).digest('hex').slice(0, 44);
    const db = getDb();
    await db.from('agent_keys').update({ owner_wallet: ownerWallet }).eq('id', agent.id);
    log.info({ agentId: agent.agent_id }, 'Auto-assigned owner_wallet for MCP user');
  }
  return { ownerWallet, agentId: agent.agent_id, scope: 'memory:read memory:write' };
}

// TEMPORARY debug capture — records what Claude's MCP request carries (token claims + verify
// result) so we can see it on prod. Remove after diagnosing the connector. Never throws.
async function logMcpDebug(req: Request, auth: McpAuth | null): Promise<void> {
  try {
    const authHeader = req.headers['authorization'] as string | undefined;
    let iss: string | null = null, aud: string | null = null, sub: string | null = null, exp: number | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      const parts = authHeader.slice(7).trim().split('.');
      if (parts.length === 3) {
        try {
          const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
          iss = p.iss ?? null;
          aud = Array.isArray(p.aud) ? p.aud.join(',') : (p.aud ?? null);
          sub = p.sub ?? null;
          exp = typeof p.exp === 'number' ? p.exp : null;
        } catch { /* not a JWT */ }
      }
    }
    const isOauth = !!auth && auth.agentId.startsWith('oauth:');
    await getDb().from('mcp_auth_debug').insert({
      has_auth: !!authHeader,
      ua: ((req.headers['user-agent'] as string | undefined) ?? '').slice(0, 160) || null,
      token_iss: iss,
      token_aud: aud,
      token_sub: sub,
      token_exp: exp,
      oauth_ok: isOauth,
      result: auth ? (isOauth ? 'oauth' : 'legacy') : 'unauthorized',
    });
  } catch { /* debug logging must never break the request */ }
}

function sendUnauthorized(res: Response, resourceMetadataUrl: string): void {
  // RFC 9728: tell Claude where to find the protected-resource metadata so
  // its OAuth client can negotiate auth automatically in future.
  res.set('WWW-Authenticate', `Bearer realm="clude", resource_metadata="${resourceMetadataUrl}"`);
  res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Unauthorized: provide a valid Bearer API key from clude.io' },
    id: null,
  });
}

export function mcpRoutes(): Router {
  const router = Router();

  // Build the protected-resource-metadata URL once per host so it's correct on
  // staging vs prod without hardcoding the domain.
  const resourceMetadataPath = '/.well-known/oauth-protected-resource';

  // POST /api/mcp — primary JSON-RPC endpoint
  router.post('/', async (req: Request, res: Response) => {
    const resourceMetadataUrl = `${req.protocol}://${req.get('host')}${resourceMetadataPath}`;
    const auth = await authFromBearer(req.headers['authorization'] as string | undefined);
    await logMcpDebug(req, auth);
    if (!auth) {
      sendUnauthorized(res, resourceMetadataUrl);
      return;
    }

    try {
      const server = buildServerForOwner(auth.ownerWallet, auth.agentId, auth.scope);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      log.error({ err }, 'MCP request failed');
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal MCP error' },
          id: null,
        });
      }
    }
  });

  // GET /api/mcp — server-initiated stream (not used in stateless mode)
  router.get('/', (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed in stateless mode' },
      id: null,
    });
  });

  // DELETE /api/mcp — session termination (no-op in stateless mode)
  router.delete('/', (_req: Request, res: Response) => {
    res.status(204).end();
  });

  return router;
}
