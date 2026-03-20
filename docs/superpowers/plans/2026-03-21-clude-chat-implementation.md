# Clude Chat Full Experience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `/chat` SPA to the real backend with guest mode, Privy auth + auto-registration, conversation history sidebar, model tiers, memory recall display, memory pack import, and cost comparison — with premium Three.js/WebGL visual polish.

**Architecture:** The chat app (`/chat`) stays a standalone Vite+React SPA. It adds Privy auth (same provider as dashboard), an auth hook managing session lifecycle, and an API client for chat + cortex endpoints. Backend gets 3 small changes: auto-register endpoint, tier/cost fields on models, and memory_ids in SSE done events.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS, Privy (`@privy-io/react-auth`), framer-motion, Three.js, `@paper-design/shaders-react`, SSE streaming, Express backend.

**Spec:** `docs/superpowers/specs/2026-03-20-clude-chat-design.md`

---

## File Structure

### New Files (Chat Frontend — `chat/src/`)
| File | Responsibility |
|------|---------------|
| `hooks/useAuth.ts` | Auth state machine: Privy + Cortex key + session lifecycle |
| `hooks/AuthContext.ts` | React context for auth state |
| `hooks/useChat.ts` | Chat state: messages, streaming, SSE connection |
| `hooks/useConversations.ts` | Conversation CRUD + list management |
| `hooks/useMemory.ts` | Memory stats, recent memories, pack import |
| `lib/api.ts` | API client for chat + cortex endpoints |
| `lib/types.ts` | Shared TypeScript interfaces |
| `components/Sidebar.tsx` | Conversation history sidebar + memory panel |
| `components/ConversationList.tsx` | Grouped conversation list with animations |
| `components/MemoryPanel.tsx` | "Your Memory" collapsible section |
| `components/MemoryImportModal.tsx` | File upload / pack ID import modal |
| `components/ModelSelector.tsx` | Model dropdown with free/pro tiers + lock icons |
| `components/MessageList.tsx` | Message display with streaming + memory annotations |
| `components/MemoryPills.tsx` | Memory annotation pills below messages |
| `components/ChatHeader.tsx` | Header with sign-in button, settings gear |
| `components/GuestRateLimit.tsx` | "X of 10 free messages" indicator |
| `components/CostComparison.tsx` | Cost comparison card/tooltip |

### Modified Files (Chat Frontend)
| File | Change |
|------|--------|
| `chat/package.json` | Add Privy, react-router-dom, three, node polyfills |
| `chat/vite.config.ts` | Add node polyfills plugin |
| `chat/src/main.tsx` | Wrap with PrivyProvider + BrowserRouter |
| `chat/src/App.tsx` | Auth flow: guest vs authenticated routing |
| `chat/src/components/chat-interface.tsx` | Replace mock responses with real streaming, integrate new components |

### Modified Files (Backend — `src/`)
| File | Change |
|------|--------|
| `src/webhook/chat-routes.ts` | Add auto-register endpoint, tier/cost to models, memory_ids in SSE done |
| `src/features/agent-tier.ts` | Add `findOrCreateAgentForWallet()` function |

---

## Task 1: Backend — Model Tier & Cost Fields

**Files:**
- Modify: `src/webhook/chat-routes.ts:22-40` (model registry)
- Modify: `src/webhook/chat-routes.ts:142-146` (GET /models endpoint)

- [ ] **Step 1: Add tier and cost fields to CHAT_MODELS**

In `src/webhook/chat-routes.ts`, add `tier` and `cost` fields to each entry in the existing `CHAT_MODELS` array. **IMPORTANT: Do NOT replace `veniceId`, `name`, or other existing values — only add the two new fields.** Read the current array first to get the exact existing values.

Add to each model entry:
- `qwen3-5-9b`: `tier: 'free' as const, cost: { input: 0, output: 0 }`
- All other private models: `tier: 'pro' as const, cost: { input: <price>, output: <price> }`
- All anonymized models: `tier: 'pro' as const, cost: { input: <price>, output: <price> }`

Approximate cost values (per 1M tokens, verify against Venice pricing):
- qwen3-next-80b: 0.35/0.35
- llama-3.3-70b: 0.20/0.20
- deepseek-v3.2: 0.20/0.20
- mistral-31-24b: 0.15/0.15
- venice-uncensored: 0.15/0.15
- kimi-k2-thinking: 0.40/0.40
- openai-gpt-oss-120b: 0.50/0.50
- claude-sonnet-4.6: 3.00/15.00
- claude-opus-4.6: 15.00/75.00
- gpt-5.4: 2.00/8.00
- grok-4.1-fast: 3.00/15.00
- gemini-3-pro: 1.25/5.00

- [ ] **Step 2: Verify the /models endpoint returns the new fields**

The existing `GET /models` endpoint at line ~142 returns `CHAT_MODELS` directly — the new `tier` and `cost` fields will be included automatically.

Run: `curl http://localhost:3000/api/chat/models | jq '.[0]'`
Expected: Object includes `tier: "free"` and `cost: { input: 0, output: 0 }`

- [ ] **Step 3: Commit**

```bash
git add src/webhook/chat-routes.ts
git commit -m "feat(chat): add tier and cost fields to model registry"
```

---

## Task 2: Backend — Guest Remaining Count

**Files:**
- Modify: `src/webhook/chat-routes.ts:147-264` (guest endpoint)

- [ ] **Step 1: Add remaining count to guest SSE done event**

The guest endpoint uses `checkRateLimit` which returns a boolean. To show "X of 10 remaining", we need to query the count. Find the guest handler's done event (around line 252) and add the remaining count.

Before the done event, add a count query:

```typescript
// After streaming completes, count today's usage for this IP
const today = new Date();
today.setHours(0, 0, 0, 0);
const { count } = await db
  .from('rate_limits')
  .select('*', { count: 'exact', head: true })
  .eq('identifier', ip)
  .eq('action', 'guest_chat')
  .gte('created_at', today.toISOString());

const remaining = Math.max(0, 10 - (count || 0));
```

Then include `remaining` in the done event:

```typescript
res.write(`data: ${JSON.stringify({ done: true, model: 'qwen3-5-9b', guest: true, remaining })}\n\n`);
```

Read the actual code first to understand the exact `checkRateLimit` implementation and table structure, then adapt accordingly.

- [ ] **Step 2: Commit**

```bash
git add src/webhook/chat-routes.ts
git commit -m "feat(chat): return remaining guest message count in SSE done event"
```

---

## Task 3: Backend — Memory IDs in SSE Done Event (was Task 2)

**Files:**
- Modify: `src/webhook/chat-routes.ts:600-630` (SSE done event in message handler)

- [ ] **Step 1: Find the SSE done event**

In `POST /conversations/:id/messages` handler, locate where the done event is sent. It currently sends `memories_used` (count). We need to add the `memory_ids` array.

- [ ] **Step 2: Add memory_ids to the done event**

Find the line that writes the done event (around line 609-614) and add `memory_ids`:

```typescript
// Change from:
res.write(`data: ${JSON.stringify({ done: true, message_id: assistantMsg.id, model: selectedModel.id, memories_used: memoryIds.length })}\n\n`);

// Change to:
res.write(`data: ${JSON.stringify({ done: true, message_id: assistantMsg.id, model: selectedModel.id, memories_used: memoryIds.length, memory_ids: memoryIds })}\n\n`);
```

The `memoryIds` variable is already populated earlier in the handler from the memory recall step.

- [ ] **Step 3: Test manually**

```bash
curl -X POST http://localhost:3000/api/chat/conversations/<id>/messages \
  -H "Authorization: Bearer clk_<key>" \
  -H "Content-Type: application/json" \
  -d '{"content":"hello"}' \
  --no-buffer
```

Expected: Final SSE event includes `memory_ids: [...]` array.

- [ ] **Step 4: Commit**

```bash
git add src/webhook/chat-routes.ts
git commit -m "feat(chat): include memory_ids array in SSE done event"
```

---

## Task 3: Backend — Auto-Register Endpoint

**Files:**
- Modify: `src/features/agent-tier.ts` (add `findOrCreateAgentForWallet`)
- Modify: `src/webhook/chat-routes.ts` (add `POST /auto-register` route)

- [ ] **Step 1: Add findOrCreateAgentForWallet in agent-tier.ts**

Add this function below the existing `registerAgent` function:

```typescript
/**
 * Find existing agent key for a wallet, or create one.
 * Returns the plaintext API key.
 * For new agents: creates and returns the key.
 * For existing agents: the key is stored plaintext in agent_keys (clk_* prefix).
 */
export async function findOrCreateAgentForWallet(wallet: string): Promise<{ apiKey: string; agentId: string; isNew: boolean }> {
  const db = getDb();

  // Check if wallet already has an agent
  const { data: existing } = await db
    .from('agent_keys')
    .select('agent_id, api_key')
    .eq('owner_wallet', wallet)
    .eq('is_active', true)
    .limit(1)
    .single();

  if (existing) {
    return { apiKey: existing.api_key, agentId: existing.agent_id, isNew: false };
  }

  // Create new agent for this wallet
  const name = `chat-${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
  const { agentId, apiKey } = await registerAgent(name, 'AGENT_VERIFIED');

  // Set the owner_wallet
  await db
    .from('agent_keys')
    .update({ owner_wallet: wallet })
    .eq('agent_id', agentId);

  return { apiKey, agentId, isNew: true };
}
```

Note: The existing codebase stores API keys in plaintext in the `api_key` column (verified from `authenticateAgent` which does `.eq('api_key', apiKey)`). The spec mentioned adding an `encrypted_key` column, but since keys are already stored plaintext, we can return them directly. No schema change needed.

- [ ] **Step 2: Add the auto-register route in chat-routes.ts**

Add this route inside the `chatRoutes()` function, **before the `router.use(chatAuth)` middleware call** (around line 265). It must be placed between the `/guest` endpoint and the `chatAuth` middleware, otherwise `chatAuth` will intercept the Privy JWT. Import `requirePrivyAuth` and `findOrCreateAgentForWallet`:

```typescript
import { requirePrivyAuth } from './privy-auth';
import { findOrCreateAgentForWallet } from '../features/agent-tier';

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
```

- [ ] **Step 3: Test the endpoint**

```bash
# This requires a valid Privy JWT — test via the frontend or mock
curl -X POST http://localhost:3000/api/chat/auto-register \
  -H "Authorization: Bearer <privy-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"wallet":"<solana-address>"}'
```

Expected: `{ api_key: "clk_...", agent_id: "agent_...", wallet: "...", created: true }`
Second call with same wallet: `{ ..., created: false }` with same key.

- [ ] **Step 4: Commit**

```bash
git add src/features/agent-tier.ts src/webhook/chat-routes.ts
git commit -m "feat(chat): add auto-register endpoint for Privy wallet auth"
```

---

## Task 4: Frontend — Dependencies & Config

**Files:**
- Modify: `chat/package.json`
- Modify: `chat/vite.config.ts`

- [ ] **Step 1: Install dependencies**

```bash
cd chat
pnpm add @privy-io/react-auth react-router-dom three @types/three vite-plugin-node-polyfills buffer
```

- [ ] **Step 2: Update vite.config.ts**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [react(), tailwindcss(), nodePolyfills()],
  base: '/chat/',
  build: {
    outDir: '../src/verify-app/public/chat',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 3: Verify it builds**

```bash
cd chat && npx vite build
```

Expected: Build completes without errors.

- [ ] **Step 4: Commit**

```bash
git add chat/package.json chat/pnpm-lock.yaml chat/vite.config.ts
git commit -m "feat(chat): add Privy, Three.js, and router dependencies"
```

---

## Task 5: Frontend — Types & API Client

**Files:**
- Create: `chat/src/lib/types.ts`
- Create: `chat/src/lib/api.ts`

- [ ] **Step 1: Create types**

```typescript
// chat/src/lib/types.ts

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model';
export type ModelTier = 'free' | 'pro';
export type ModelPrivacy = 'private' | 'anonymized';

export interface ChatModel {
  id: string;
  name: string;
  privacy: ModelPrivacy;
  context: number;
  default?: boolean;
  tier: ModelTier;
  cost: { input: number; output: number };
}

export interface Conversation {
  id: string;
  owner_wallet: string;
  title: string | null;
  model: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  memory_ids?: number[];
  created_at: string;
}

export interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  avgImportance: number;
  avgDecay: number;
  topTags: Array<{ tag: string; count: number }>;
}

export interface MemorySummary {
  id: number;
  memory_type: MemoryType;
  summary: string;
  importance: number;
  created_at: string;
}

export interface GuestResponse {
  content: string;
  done: boolean;
  model: string;
  guest: boolean;
  remaining?: number;
}

export interface AuthDoneEvent {
  done: true;
  message_id: string;
  model: string;
  memories_used: number;
  memory_ids: number[];
}
```

- [ ] **Step 2: Create API client**

```typescript
// chat/src/lib/api.ts

import type { ChatModel, Conversation, Message, MemoryStats, MemorySummary } from './types';

const API_BASE = '';  // Same origin, proxied in dev

class ChatAPI {
  private cortexKey: string | null = null;

  setKey(key: string | null) {
    this.cortexKey = key;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cortexKey) {
      h['Authorization'] = `Bearer ${this.cortexKey}`;
    }
    return h;
  }

  // ── Models ──
  async getModels(): Promise<ChatModel[]> {
    const res = await fetch(`${API_BASE}/api/chat/models`);
    if (!res.ok) throw new Error('Failed to fetch models');
    return res.json();
  }

  // ── Auto-register ──
  async autoRegister(privyToken: string, wallet: string): Promise<{ api_key: string; agent_id: string; created: boolean }> {
    const res = await fetch(`${API_BASE}/api/chat/auto-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${privyToken}` },
      body: JSON.stringify({ wallet }),
    });
    if (!res.ok) throw new Error('Auto-register failed');
    return res.json();
  }

  // ── Guest chat (SSE) ──
  async sendGuestMessage(content: string, history: Array<{ role: string; content: string }>, onChunk: (text: string) => void, onDone: (remaining?: number) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${API_BASE}/api/chat/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, history }),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await this.readSSE(res, onChunk, (data) => onDone(data?.remaining));
  }

  // ── Conversations ──
  async createConversation(model?: string): Promise<Conversation> {
    const res = await fetch(`${API_BASE}/api/chat/conversations`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model }),
    });
    if (!res.ok) throw new Error('Failed to create conversation');
    return res.json();
  }

  async listConversations(limit = 50): Promise<Conversation[]> {
    const res = await fetch(`${API_BASE}/api/chat/conversations?limit=${limit}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Failed to list conversations');
    return res.json();
  }

  async getConversation(id: string): Promise<Conversation & { messages: Message[] }> {
    const res = await fetch(`${API_BASE}/api/chat/conversations/${id}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Failed to get conversation');
    return res.json();
  }

  async deleteConversation(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/chat/conversations/${id}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Failed to delete conversation');
  }

  // ── Authenticated chat (SSE) ──
  async sendMessage(conversationId: string, content: string, model: string, onChunk: (text: string) => void, onDone: (data: any) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${API_BASE}/api/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ content, model }),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await this.readSSE(res, onChunk, onDone);
  }

  // ── Memory (Cortex endpoints) ──
  async getMemoryStats(): Promise<MemoryStats> {
    const res = await fetch(`${API_BASE}/api/cortex/stats`, { headers: this.headers() });
    if (!res.ok) throw new Error('Failed to fetch memory stats');
    return res.json();
  }

  async getRecentMemories(limit = 20): Promise<MemorySummary[]> {
    const res = await fetch(`${API_BASE}/api/cortex/recent?limit=${limit}`, { headers: this.headers() });
    if (!res.ok) throw new Error('Failed to fetch recent memories');
    const data = await res.json();
    return data.memories || data;
  }

  async importMemoryPack(pack: any): Promise<{ imported: number }> {
    const res = await fetch(`${API_BASE}/api/cortex/packs/import`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ pack }),
    });
    if (!res.ok) throw new Error('Failed to import memory pack');
    return res.json();
  }

  async validateKey(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/api/cortex/stats`, { headers: this.headers() });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── SSE reader ──
  private async readSSE(res: Response, onChunk: (text: string) => void, onDone: (data?: any) => void): Promise<void> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (raw === '[DONE]') { onDone(); return; }
        try {
          const data = JSON.parse(raw);
          if (data.done) { onDone(data); return; }
          if (data.content) onChunk(data.content);
          if (data.chunk) onChunk(data.chunk);
        } catch { /* skip malformed */ }
      }
    }
    onDone();
  }
}

export const api = new ChatAPI();
```

- [ ] **Step 3: Commit**

```bash
git add chat/src/lib/types.ts chat/src/lib/api.ts
git commit -m "feat(chat): add types and API client"
```

---

## Task 6: Frontend — Auth Hook & Context

**Files:**
- Create: `chat/src/hooks/AuthContext.ts`
- Create: `chat/src/hooks/useAuth.ts`

- [ ] **Step 1: Create AuthContext**

```typescript
// chat/src/hooks/AuthContext.ts

import { createContext, useContext } from 'react';

export interface AuthState {
  ready: boolean;
  authenticated: boolean;
  walletAddress: string | null;
  authMode: 'privy' | 'cortex' | null;
  cortexKey: string | null;
  login: () => void;
  logout: () => void;
  loginWithApiKey: (apiKey: string) => Promise<boolean>;
}

const defaultState: AuthState = {
  ready: false,
  authenticated: false,
  walletAddress: null,
  authMode: null,
  cortexKey: null,
  login: () => {},
  logout: () => {},
  loginWithApiKey: async () => false,
};

export const AuthContext = createContext<AuthState>(defaultState);
export const useAuthContext = () => useContext(AuthContext);
```

- [ ] **Step 2: Create useAuth hook**

```typescript
// chat/src/hooks/useAuth.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets } from '@privy-io/react-auth/solana';
import { api } from '../lib/api';
import type { AuthState } from './AuthContext';

const STORAGE_KEYS = {
  cortexKey: 'chat_cortex_key',
  wallet: 'chat_wallet',
} as const;

export function useAuth(): AuthState {
  const { ready: privyReady, authenticated: privyAuth, login: privyLogin, logout: privyLogout, getAccessToken } = usePrivy();
  const { wallets } = useSolanaWallets();

  const [cortexKey, setCortexKey] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'privy' | 'cortex' | null>(null);
  const [ready, setReady] = useState(false);

  const cortexInitRef = useRef(false);

  // ── Restore saved cortex key on mount ──
  useEffect(() => {
    const savedKey = localStorage.getItem(STORAGE_KEYS.cortexKey);
    const savedWallet = localStorage.getItem(STORAGE_KEYS.wallet);
    if (savedKey) {
      cortexInitRef.current = true;
      api.setKey(savedKey);
      api.validateKey().then((valid) => {
        if (valid) {
          setCortexKey(savedKey);
          setWalletAddress(savedWallet);
          setAuthMode(savedWallet ? 'privy' : 'cortex');
        } else {
          localStorage.removeItem(STORAGE_KEYS.cortexKey);
          localStorage.removeItem(STORAGE_KEYS.wallet);
          api.setKey(null);
        }
        setReady(true);
        cortexInitRef.current = false;
      });
    } else if (privyReady) {
      setReady(true);
    }
  }, [privyReady]);

  // ── Privy auth → auto-register ──
  useEffect(() => {
    if (cortexInitRef.current || !privyReady || !privyAuth || cortexKey) return;

    const wallet = wallets?.[0]?.address;
    if (!wallet) return;

    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;

        const result = await api.autoRegister(token, wallet);
        api.setKey(result.api_key);
        setCortexKey(result.api_key);
        setWalletAddress(wallet);
        setAuthMode('privy');

        localStorage.setItem(STORAGE_KEYS.cortexKey, result.api_key);
        localStorage.setItem(STORAGE_KEYS.wallet, wallet);
      } catch (err) {
        console.error('Auto-register failed:', err);
      }
    })();
  }, [privyReady, privyAuth, wallets, cortexKey]);

  // ── Mark ready when Privy loads (if no saved key) ──
  useEffect(() => {
    if (privyReady && !cortexInitRef.current && !ready) {
      setReady(true);
    }
  }, [privyReady, ready]);

  // ── Login (triggers Privy modal) ──
  const login = useCallback(() => {
    privyLogin();
  }, [privyLogin]);

  // ── Logout (full state clear) ──
  const logout = useCallback(() => {
    setCortexKey(null);
    setWalletAddress(null);
    setAuthMode(null);
    api.setKey(null);
    localStorage.removeItem(STORAGE_KEYS.cortexKey);
    localStorage.removeItem(STORAGE_KEYS.wallet);
    if (privyAuth) {
      privyLogout();
    }
  }, [privyAuth, privyLogout]);

  // ── Manual API key login (power users) ──
  const loginWithApiKey = useCallback(async (apiKey: string): Promise<boolean> => {
    // Clear any existing state first
    if (cortexKey) {
      setCortexKey(null);
      setWalletAddress(null);
      setAuthMode(null);
      api.setKey(null);
      localStorage.removeItem(STORAGE_KEYS.cortexKey);
      localStorage.removeItem(STORAGE_KEYS.wallet);
    }

    api.setKey(apiKey);
    const valid = await api.validateKey();
    if (!valid) {
      api.setKey(null);
      return false;
    }

    setCortexKey(apiKey);
    setAuthMode('cortex');
    localStorage.setItem(STORAGE_KEYS.cortexKey, apiKey);
    return true;
  }, [cortexKey]);

  return {
    ready,
    authenticated: !!cortexKey,
    walletAddress,
    authMode,
    cortexKey,
    login,
    logout,
    loginWithApiKey,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add chat/src/hooks/AuthContext.ts chat/src/hooks/useAuth.ts
git commit -m "feat(chat): add auth hook with Privy + Cortex key + session management"
```

---

## Task 7: Frontend — App Shell & Privy Provider

**Files:**
- Modify: `chat/src/main.tsx`
- Modify: `chat/src/App.tsx`

- [ ] **Step 1: Update main.tsx with PrivyProvider**

```typescript
// chat/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import './index.css'

const solanaConnectors = toSolanaWalletConnectors({
  shouldAutoConnect: true,
});

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID;
if (!privyAppId) throw new Error('VITE_PRIVY_APP_ID is required');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider
      appId={privyAppId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#2244ff',
          walletList: ['phantom', 'solflare', 'backpack', 'detected_wallets'],
        },
        loginMethods: ['wallet'],
        walletChainType: 'solana-only',
        embeddedWallets: { createOnLogin: 'off' },
        solanaClusters: [{ name: 'mainnet-beta', rpcUrl: 'https://api.mainnet-beta.solana.com' }],
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
      }}
    >
      <BrowserRouter basename="/chat">
        <App />
      </BrowserRouter>
    </PrivyProvider>
  </StrictMode>,
)
```

- [ ] **Step 2: Update App.tsx with auth routing**

```typescript
// chat/src/App.tsx
import { useAuth } from './hooks/useAuth'
import { AuthContext } from './hooks/AuthContext'
import { ChatInterface } from './components/chat-interface'

export function App() {
  const auth = useAuth();

  if (!auth.ready) return null;

  // Unique key forces full remount on auth mode change
  const identity = auth.authenticated
    ? `${auth.authMode}-${auth.cortexKey?.slice(-8) || ''}`
    : 'guest';

  return (
    <AuthContext.Provider value={auth} key={identity}>
      <div className="min-h-screen bg-black">
        <ChatInterface />
      </div>
    </AuthContext.Provider>
  );
}
```

- [ ] **Step 3: Add VITE_PRIVY_APP_ID to chat/.env**

Create `chat/.env`:
```
VITE_PRIVY_APP_ID=<same-value-as-dashboard>
```

Check `dashboard/.env` or `dashboard/.env.local` for the Privy app ID to copy.

- [ ] **Step 4: Verify it builds**

```bash
cd chat && npx vite build
```

- [ ] **Step 5: Commit**

```bash
git add chat/src/main.tsx chat/src/App.tsx
git commit -m "feat(chat): add Privy provider and auth-aware app shell"
```

---

## Task 8: Frontend — Model Selector Component

**Files:**
- Create: `chat/src/components/ModelSelector.tsx`

- [ ] **Step 1: Create ModelSelector**

Build the model dropdown with free/pro tiers, lock icons, and shimmer effects on locked models. Uses framer-motion for spring transitions. When a guest clicks a locked model, fire the Privy login.

```typescript
// chat/src/components/ModelSelector.tsx
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Zap, Shield, ChevronDown } from 'lucide-react';
import { useAuthContext } from '../hooks/AuthContext';
import { api } from '../lib/api';
import type { ChatModel } from '../lib/types';

interface Props {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
}

export function ModelSelector({ selectedModel, onModelChange }: Props) {
  const { authenticated, login } = useAuthContext();
  const [models, setModels] = useState<ChatModel[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.getModels().then(setModels).catch(console.error);
  }, []);

  const current = models.find((m) => m.id === selectedModel) || models.find((m) => m.default);

  const handleSelect = (model: ChatModel) => {
    if (model.tier === 'pro' && !authenticated) {
      login();
      return;
    }
    onModelChange(model.id);
    setOpen(false);
  };

  const privateModels = models.filter((m) => m.privacy === 'private');
  const anonymizedModels = models.filter((m) => m.privacy === 'anonymized');

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700 hover:bg-zinc-800 text-white text-[11px] rounded-full px-3 h-7 min-w-[140px] transition-colors"
      >
        <Zap className="h-3 w-3 text-blue-400" />
        <span className="truncate">{current?.name || 'Select model'}</span>
        <ChevronDown className="h-3 w-3 ml-auto opacity-50" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="absolute bottom-full mb-2 left-0 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl z-50 overflow-hidden"
          >
            {/* Private models */}
            <div className="px-3 py-1.5 text-[9px] tracking-widest uppercase text-zinc-500 border-b border-zinc-800 flex items-center gap-1.5">
              <Shield className="h-3 w-3" /> Private — Zero Data Retention
            </div>
            {privateModels.map((model) => (
              <ModelItem
                key={model.id}
                model={model}
                selected={model.id === selectedModel}
                locked={model.tier === 'pro' && !authenticated}
                onClick={() => handleSelect(model)}
              />
            ))}

            {/* Anonymized models */}
            <div className="px-3 py-1.5 text-[9px] tracking-widest uppercase text-zinc-500 border-b border-zinc-800 border-t flex items-center gap-1.5">
              <Shield className="h-3 w-3 opacity-50" /> Anonymized — No Identity Attached
            </div>
            {anonymizedModels.map((model) => (
              <ModelItem
                key={model.id}
                model={model}
                selected={model.id === selectedModel}
                locked={model.tier === 'pro' && !authenticated}
                onClick={() => handleSelect(model)}
              />
            ))}

            {/* Cost comparison footer */}
            <div className="px-3 py-2 border-t border-zinc-800 text-[9px] text-zinc-500">
              Private models cost up to <span className="text-blue-400">250x less</span> than direct API access
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModelItem({ model, selected, locked, onClick }: {
  model: ChatModel;
  selected: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  const costPerMsg = model.cost.input === 0 ? 'Free' :
    `~$${((model.cost.input + model.cost.output) * 0.0005).toFixed(4)}/msg`;

  return (
    <button
      onClick={onClick}
      className={`w-full px-3 py-2 flex items-center gap-2 text-left transition-colors ${
        selected ? 'bg-blue-600/15 text-white' :
        locked ? 'text-zinc-500 hover:bg-zinc-800/50' :
        'text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`text-[11px] truncate ${locked ? 'opacity-50' : ''}`}>{model.name}</span>
          {locked && <Lock className="h-2.5 w-2.5 flex-shrink-0 text-zinc-600" />}
        </div>
        <div className="text-[9px] text-zinc-600 flex gap-2">
          <span>{(model.context / 1000).toFixed(0)}K ctx</span>
          <span>{costPerMsg}</span>
        </div>
      </div>
      {selected && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add chat/src/components/ModelSelector.tsx
git commit -m "feat(chat): add model selector with free/pro tiers and lock icons"
```

---

## Task 9: Frontend — Chat Hook & Streaming

**Files:**
- Create: `chat/src/hooks/useChat.ts`

- [ ] **Step 1: Create useChat hook**

This hook manages message state, SSE streaming, and the abort controller.

```typescript
// chat/src/hooks/useChat.ts

import { useState, useCallback, useRef } from 'react';
import { useAuthContext } from './AuthContext';
import { api } from '../lib/api';
import type { Message } from '../lib/types';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  memoryIds?: number[];
  streaming?: boolean;
}

export function useChat() {
  const { authenticated } = useAuthContext();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [guestRemaining, setGuestRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (
    content: string,
    conversationId: string | null,
    model: string,
  ) => {
    setError(null);

    // Add user message
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
    };
    setMessages((prev) => [...prev, userMsg]);

    // Add placeholder assistant message
    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', streaming: true }]);
    setStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      if (!authenticated || !conversationId) {
        // Guest mode
        const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
        await api.sendGuestMessage(
          content,
          history,
          (chunk) => {
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: m.content + chunk } : m)
            );
          },
          (remaining) => {
            if (remaining !== undefined) setGuestRemaining(remaining);
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, streaming: false } : m)
            );
          },
          abort.signal,
        );
      } else {
        // Authenticated mode
        await api.sendMessage(
          conversationId,
          content,
          model,
          (chunk) => {
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId ? { ...m, content: m.content + chunk } : m)
            );
          },
          (data) => {
            setMessages((prev) =>
              prev.map((m) => m.id === assistantId
                ? { ...m, id: data?.message_id || m.id, streaming: false, memoryIds: data?.memory_ids }
                : m)
            );
          },
          abort.signal,
        );
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId ? { ...m, streaming: false } : m)
        );
      } else {
        setError(err.message || 'Something went wrong');
        setMessages((prev) =>
          prev.map((m) => m.id === assistantId
            ? { ...m, content: m.content || 'Response interrupted', streaming: false }
            : m)
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [authenticated, messages]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const loadMessages = useCallback((msgs: Message[]) => {
    setMessages(msgs.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      memoryIds: m.memory_ids,
    })));
  }, []);

  return {
    messages,
    streaming,
    guestRemaining,
    error,
    sendMessage,
    stopStreaming,
    clearMessages,
    loadMessages,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add chat/src/hooks/useChat.ts
git commit -m "feat(chat): add useChat hook with SSE streaming and abort support"
```

---

## Task 10: Frontend — Conversations Hook

**Files:**
- Create: `chat/src/hooks/useConversations.ts`

- [ ] **Step 1: Create useConversations hook**

```typescript
// chat/src/hooks/useConversations.ts

import { useState, useCallback, useEffect } from 'react';
import { useAuthContext } from './AuthContext';
import { api } from '../lib/api';
import type { Conversation } from '../lib/types';

export function useConversations() {
  const { authenticated } = useAuthContext();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch conversations on auth
  useEffect(() => {
    if (!authenticated) {
      setConversations([]);
      setActiveId(null);
      return;
    }
    setLoading(true);
    api.listConversations(50)
      .then(setConversations)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [authenticated]);

  const createConversation = useCallback(async (model: string): Promise<string> => {
    const conv = await api.createConversation(model);
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    return conv.id;
  }, []);

  const selectConversation = useCallback(async (id: string) => {
    setActiveId(id);
    const data = await api.getConversation(id);
    return data.messages;
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    await api.deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }, [activeId]);

  const refreshTitle = useCallback(async (id: string) => {
    try {
      const data = await api.getConversation(id);
      setConversations((prev) =>
        prev.map((c) => c.id === id ? { ...c, title: data.title, message_count: data.message_count, updated_at: data.updated_at } : c)
      );
    } catch { /* ignore */ }
  }, []);

  return {
    conversations,
    activeId,
    loading,
    createConversation,
    selectConversation,
    deleteConversation,
    refreshTitle,
    setActiveId,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add chat/src/hooks/useConversations.ts
git commit -m "feat(chat): add useConversations hook for conversation CRUD"
```

---

## Task 11: Frontend — Memory Hook

**Files:**
- Create: `chat/src/hooks/useMemory.ts`

- [ ] **Step 1: Create useMemory hook**

```typescript
// chat/src/hooks/useMemory.ts

import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from './AuthContext';
import { api } from '../lib/api';
import type { MemoryStats, MemorySummary } from '../lib/types';

export function useMemory() {
  const { authenticated } = useAuthContext();
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [recent, setRecent] = useState<MemorySummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authenticated) {
      setStats(null);
      setRecent([]);
      return;
    }
    setLoading(true);
    Promise.all([
      api.getMemoryStats().catch(() => null),
      api.getRecentMemories(20).catch(() => []),
    ]).then(([s, r]) => {
      setStats(s);
      setRecent(r);
    }).finally(() => setLoading(false));
  }, [authenticated]);

  const importPack = useCallback(async (pack: any): Promise<number> => {
    const result = await api.importMemoryPack(pack);
    // Refresh stats after import
    const [s, r] = await Promise.all([
      api.getMemoryStats().catch(() => null),
      api.getRecentMemories(20).catch(() => []),
    ]);
    setStats(s);
    setRecent(r);
    return result.imported;
  }, []);

  return { stats, recent, loading, importPack };
}
```

- [ ] **Step 2: Commit**

```bash
git add chat/src/hooks/useMemory.ts
git commit -m "feat(chat): add useMemory hook for stats, recent memories, and pack import"
```

---

## Task 12: Frontend — Conversation Sidebar

**Files:**
- Create: `chat/src/components/Sidebar.tsx`
- Create: `chat/src/components/ConversationList.tsx`
- Create: `chat/src/components/MemoryPanel.tsx`
- Create: `chat/src/components/MemoryImportModal.tsx`

- [ ] **Step 1: Create ConversationList**

Grouped by time (Today, Yesterday, Previous 7 Days, Older). Each item has staggered spring entrance animation. Active item has blue accent. Hover shows delete button.

```typescript
// chat/src/components/ConversationList.tsx

import { motion } from 'framer-motion';
import { Trash2, MessageSquare } from 'lucide-react';
import type { Conversation } from '../lib/types';

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function groupByTime(convs: Conversation[]) {
  const now = Date.now();
  const day = 86400000;
  const groups: Record<string, Conversation[]> = {};

  for (const c of convs) {
    const age = now - new Date(c.updated_at).getTime();
    const label = age < day ? 'Today' : age < 2 * day ? 'Yesterday' : age < 7 * day ? 'Previous 7 Days' : 'Older';
    (groups[label] ||= []).push(c);
  }
  return groups;
}

export function ConversationList({ conversations, activeId, onSelect, onDelete }: Props) {
  const groups = groupByTime(conversations);

  return (
    <div className="flex-1 overflow-y-auto px-2">
      {Object.entries(groups).map(([label, convs]) => (
        <div key={label} className="mb-3">
          <div className="text-[9px] tracking-widest uppercase text-zinc-600 px-2 py-1">{label}</div>
          {convs.map((conv, i) => (
            <motion.button
              key={conv.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03, type: 'spring', stiffness: 300, damping: 25 }}
              onClick={() => onSelect(conv.id)}
              className={`group w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-colors text-[11px] ${
                conv.id === activeId
                  ? 'bg-blue-600/15 text-white border-l-2 border-blue-500'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
              }`}
            >
              <MessageSquare className="h-3 w-3 flex-shrink-0 opacity-50" />
              <span className="truncate flex-1">{conv.title || 'New conversation'}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </motion.button>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create MemoryPanel**

```typescript
// chat/src/components/MemoryPanel.tsx

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ChevronDown, Upload, ExternalLink } from 'lucide-react';
import type { MemoryStats, MemorySummary, MemoryType } from '../lib/types';

interface Props {
  stats: MemoryStats | null;
  recent: MemorySummary[];
  onImport: () => void;
}

const TYPE_LABELS: Record<MemoryType, { label: string; color: string }> = {
  episodic: { label: 'Episodic', color: 'text-blue-400' },
  semantic: { label: 'Semantic', color: 'text-indigo-400' },
  procedural: { label: 'Procedural', color: 'text-green-400' },
  self_model: { label: 'Self Model', color: 'text-purple-400' },
};

export function MemoryPanel({ stats, recent, onImport }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [expandedType, setExpandedType] = useState<MemoryType | null>(null);

  if (!stats) return null;

  return (
    <div className="border-t border-zinc-800 px-2 py-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors"
      >
        <Brain className="h-3.5 w-3.5 text-blue-400" />
        <span>Your Memory</span>
        <span className="text-zinc-600 ml-auto mr-1">{stats.total}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {/* Type breakdown */}
            <div className="px-2 py-1 space-y-1">
              {(Object.keys(TYPE_LABELS) as MemoryType[]).map((type) => {
                const count = stats.byType[type] || 0;
                if (count === 0) return null;
                const typeRecent = recent.filter((m) => m.memory_type === type);
                return (
                  <div key={type}>
                    <button
                      onClick={() => setExpandedType(expandedType === type ? null : type)}
                      className="w-full flex items-center gap-2 py-0.5 text-[10px]"
                    >
                      <span className={TYPE_LABELS[type].color}>{TYPE_LABELS[type].label}</span>
                      <span className="text-zinc-600 ml-auto">{count}</span>
                    </button>
                    <AnimatePresence>
                      {expandedType === type && typeRecent.length > 0 && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: 'auto' }}
                          exit={{ height: 0 }}
                          className="overflow-hidden pl-3"
                        >
                          {typeRecent.slice(0, 5).map((m) => (
                            <div key={m.id} className="text-[9px] text-zinc-500 py-0.5 truncate">
                              {m.summary || 'Untitled memory'}
                            </div>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="px-2 py-1.5 flex gap-2">
              <button
                onClick={onImport}
                className="flex items-center gap-1 text-[9px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                <Upload className="h-2.5 w-2.5" /> Import Pack
              </button>
              <a
                href="/dashboard"
                target="_blank"
                className="flex items-center gap-1 text-[9px] text-zinc-500 hover:text-zinc-400 transition-colors ml-auto"
              >
                Dashboard <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 3: Create MemoryImportModal**

```typescript
// chat/src/components/MemoryImportModal.tsx

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, Upload, FileJson } from 'lucide-react';

interface Props {
  onImport: (pack: any) => Promise<number>;
  onClose: () => void;
}

export function MemoryImportModal({ onImport, onClose }: Props) {
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setResult(null);
    setImporting(true);
    try {
      const text = await file.text();
      const pack = JSON.parse(text);
      const count = await onImport(pack);
      setResult(`Imported ${count} memories`);
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }, [onImport]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-md p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white text-sm font-medium">Import Memory Pack</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragging ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-700 hover:border-zinc-600'
          }`}
        >
          <FileJson className="h-8 w-8 mx-auto mb-3 text-zinc-500" />
          <p className="text-zinc-400 text-xs mb-2">
            {importing ? 'Importing...' : 'Drop a .json memory pack here'}
          </p>
          <label className="text-blue-400 text-xs cursor-pointer hover:text-blue-300">
            or browse files
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>
        </div>

        {result && <p className="mt-3 text-green-400 text-xs text-center">{result}</p>}
        {error && <p className="mt-3 text-red-400 text-xs text-center">{error}</p>}
      </motion.div>
    </motion.div>
  );
}
```

- [ ] **Step 4: Create Sidebar (composes ConversationList + MemoryPanel)**

```typescript
// chat/src/components/Sidebar.tsx

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, PanelLeftClose, PanelLeft } from 'lucide-react';
import { ConversationList } from './ConversationList';
import { MemoryPanel } from './MemoryPanel';
import { MemoryImportModal } from './MemoryImportModal';
import type { Conversation, MemoryStats, MemorySummary } from '../lib/types';

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  stats: MemoryStats | null;
  recentMemories: MemorySummary[];
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  onImportPack: (pack: any) => Promise<number>;
}

export function Sidebar({ conversations, activeId, stats, recentMemories, onSelect, onDelete, onNewChat, onImportPack }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [showImport, setShowImport] = useState(false);

  return (
    <>
      {/* Collapse toggle when sidebar is hidden */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="fixed top-3 left-3 z-40 p-2 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
      )}

      <AnimatePresence>
        {!collapsed && (
          <motion.aside
            initial={{ x: -260, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -260, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="w-[260px] h-screen bg-zinc-950 border-r border-zinc-800 flex flex-col fixed left-0 top-0 z-30"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-3 border-b border-zinc-800">
              <button
                onClick={onNewChat}
                className="flex items-center gap-1.5 text-[11px] text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Plus className="h-3 w-3" /> New Chat
              </button>
              <button
                onClick={() => setCollapsed(true)}
                className="text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>

            {/* Conversations */}
            <ConversationList
              conversations={conversations}
              activeId={activeId}
              onSelect={onSelect}
              onDelete={onDelete}
            />

            {/* Memory panel */}
            <MemoryPanel
              stats={stats}
              recent={recentMemories}
              onImport={() => setShowImport(true)}
            />
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Import modal */}
      <AnimatePresence>
        {showImport && (
          <MemoryImportModal
            onImport={onImportPack}
            onClose={() => setShowImport(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add chat/src/components/Sidebar.tsx chat/src/components/ConversationList.tsx chat/src/components/MemoryPanel.tsx chat/src/components/MemoryImportModal.tsx
git commit -m "feat(chat): add conversation sidebar with memory panel and pack import"
```

---

## Task 13: Frontend — Memory Pills & Message List

**Files:**
- Create: `chat/src/components/MemoryPills.tsx`
- Create: `chat/src/components/MessageList.tsx`
- Create: `chat/src/components/GuestRateLimit.tsx`
- Create: `chat/src/components/CostComparison.tsx`
- Create: `chat/src/components/ChatHeader.tsx`

- [ ] **Step 1: Create MemoryPills**

Memory annotation pills that appear below assistant messages when Brain button is toggled.

```typescript
// chat/src/components/MemoryPills.tsx

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import type { MemoryType } from '../lib/types';

const TYPE_ICONS: Record<MemoryType, string> = {
  episodic: 'E',
  semantic: 'S',
  procedural: 'P',
  self_model: 'I',
};

const TYPE_COLORS: Record<MemoryType, string> = {
  episodic: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  semantic: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  procedural: 'bg-green-500/20 text-green-400 border-green-500/30',
  self_model: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

interface MemoryDetail {
  id: number;
  memory_type: MemoryType;
  summary: string;
  content: string;
  importance: number;
}

interface Props {
  memoryIds: number[];
  visible: boolean;
}

export function MemoryPills({ memoryIds, visible }: Props) {
  const [memories, setMemories] = useState<MemoryDetail[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (!visible || memoryIds.length === 0) return;
    // Fetch memory details via hydrate endpoint
    api.getMemoryStats().catch(() => null); // Trigger auth check
    // For now, show IDs — full hydration can use /api/cortex/hydrate
    setMemories(memoryIds.map((id) => ({
      id,
      memory_type: 'semantic' as MemoryType,
      summary: `Memory #${id}`,
      content: '',
      importance: 0,
    })));
  }, [memoryIds, visible]);

  if (!visible || memoryIds.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        className="flex flex-wrap gap-1 mt-1"
      >
        {memories.map((mem) => (
          <motion.button
            key={mem.id}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={() => setExpandedId(expandedId === mem.id ? null : mem.id)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border transition-colors ${TYPE_COLORS[mem.memory_type]}`}
          >
            <span className="font-bold">{TYPE_ICONS[mem.memory_type]}</span>
            <span className="truncate max-w-[120px]">{mem.summary}</span>
          </motion.button>
        ))}
      </motion.div>
    </AnimatePresence>
  );
}
```

- [ ] **Step 2: Create GuestRateLimit**

```typescript
// chat/src/components/GuestRateLimit.tsx

import { useAuthContext } from '../hooks/AuthContext';

interface Props {
  remaining: number | null;
}

export function GuestRateLimit({ remaining }: Props) {
  const { authenticated, login } = useAuthContext();
  if (authenticated || remaining === null) return null;

  const atLimit = remaining <= 0;

  return (
    <div className="text-center py-2">
      {atLimit ? (
        <button
          onClick={login}
          className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
        >
          Free messages used up. Sign in for unlimited.
        </button>
      ) : (
        <span className="text-[10px] text-zinc-600">
          {remaining} of 10 free messages remaining
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create CostComparison**

```typescript
// chat/src/components/CostComparison.tsx

import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingDown } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const COMPARISONS = [
  { provider: 'Clude', model: 'qwen3-5-9b', cost: 'Free', note: 'Private, zero retention' },
  { provider: 'Clude', model: 'llama-3.3-70b', cost: '~$0.0002/msg', note: 'Private, zero retention' },
  { provider: 'Clude', model: 'deepseek-v3.2', cost: '~$0.0002/msg', note: 'Private, zero retention' },
  { provider: 'OpenAI', model: 'GPT-5.4', cost: '~$0.005/msg', note: 'Direct API pricing' },
  { provider: 'Anthropic', model: 'Claude Opus 4.6', cost: '~$0.05/msg', note: 'Direct API pricing' },
];

export function CostComparison({ open, onClose }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className="absolute bottom-full mb-2 right-0 w-80 bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl z-50 p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5 text-[11px] text-white font-medium">
              <TrendingDown className="h-3.5 w-3.5 text-green-400" /> Cost Comparison
            </div>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="space-y-1.5">
            {COMPARISONS.map((c, i) => (
              <div key={i} className={`flex items-center justify-between text-[10px] py-1 ${
                c.provider === 'Clude' ? 'text-zinc-300' : 'text-zinc-500'
              }`}>
                <div>
                  <span className="font-medium">{c.model}</span>
                  <span className="text-zinc-600 ml-1.5">{c.note}</span>
                </div>
                <span className={c.provider === 'Clude' ? 'text-green-400 font-medium' : ''}>{c.cost}</span>
              </div>
            ))}
          </div>

          <div className="mt-3 pt-2 border-t border-zinc-800 text-[9px] text-zinc-500">
            Private models: up to 250x cheaper. Zero data retention. Your prompts are never stored.
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 4: Create ChatHeader**

```typescript
// chat/src/components/ChatHeader.tsx

import { useState } from 'react';
import { Settings, LogOut, Key } from 'lucide-react';
import { useAuthContext } from '../hooks/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';

export function ChatHeader() {
  const { authenticated, walletAddress, authMode, login, logout, loginWithApiKey } = useAuthContext();
  const [showSettings, setShowSettings] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');

  const handleApiKeySubmit = async () => {
    if (!apiKeyInput.trim()) return;
    setApiKeyError('');
    const valid = await loginWithApiKey(apiKeyInput.trim());
    if (!valid) setApiKeyError('Invalid API key');
    else setShowSettings(false);
  };

  return (
    <div className="flex items-center justify-end gap-2 px-4 py-2">
      {authenticated ? (
        <>
          <span className="text-[10px] text-zinc-500">
            {walletAddress ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}` : authMode}
          </span>
          <button onClick={logout} className="text-zinc-500 hover:text-zinc-300 transition-colors" title="Sign out">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <button
          onClick={login}
          className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors px-3 py-1 border border-blue-500/30 rounded-full"
        >
          Sign in
        </button>
      )}

      <button
        onClick={() => setShowSettings(!showSettings)}
        className="text-zinc-600 hover:text-zinc-400 transition-colors"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>

      {/* Settings panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute top-12 right-4 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 p-3"
          >
            <div className="text-[10px] text-zinc-400 mb-2 flex items-center gap-1">
              <Key className="h-3 w-3" /> Connect API Key
            </div>
            <div className="flex gap-1.5">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="clk_..."
                onKeyDown={(e) => e.key === 'Enter' && handleApiKeySubmit()}
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-blue-500"
              />
              <button
                onClick={handleApiKeySubmit}
                className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] rounded transition-colors"
              >
                Go
              </button>
            </div>
            {apiKeyError && <p className="text-[9px] text-red-400 mt-1">{apiKeyError}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add chat/src/components/MemoryPills.tsx chat/src/components/GuestRateLimit.tsx chat/src/components/CostComparison.tsx chat/src/components/ChatHeader.tsx
git commit -m "feat(chat): add memory pills, rate limit indicator, cost comparison, and header"
```

---

## Task 14: Frontend — Rewrite ChatInterface (Main Integration)

**Files:**
- Modify: `chat/src/components/chat-interface.tsx` (full rewrite)

This is the big integration task. Replace the mock chat interface with the real one, composing all the components built in previous tasks.

- [ ] **Step 1: Rewrite chat-interface.tsx**

Full rewrite replacing mock responses with real SSE streaming, integrating sidebar, model selector, brain button, header, and all hooks. Preserve the existing LiquidMetal/PulsingBorder shader effects from the current file.

Key integration points:
- `useAuthContext()` for auth state
- `useChat()` for messages + streaming
- `useConversations()` for sidebar
- `useMemory()` for memory panel
- `<Sidebar>` rendered conditionally (auth only)
- `<ModelSelector>` replaces the hardcoded select
- `<ChatHeader>` at top
- `<GuestRateLimit>` below messages
- Brain button toggles `<MemoryPills>` on assistant messages
- `<CostComparison>` accessible from bottom bar
- Existing LiquidMetal avatar + PulsingBorder input animations preserved
- Assistant avatar LiquidMetal `speed` prop increases during streaming
- Main content area shifts right by 260px when sidebar is visible

This file is too large to include inline — the implementing agent should read the current `chat-interface.tsx` first to preserve shader configurations, then rebuild the component integrating all the hooks and subcomponents above.

- [ ] **Step 2: Verify it builds**

```bash
cd chat && npx vite build
```

- [ ] **Step 3: Test locally**

```bash
cd chat && npx vite dev
```

Open `http://localhost:5173/chat/`. Verify:
- Guest mode: can send messages, gets real responses from `qwen3-5-9b`
- Model selector shows all 13 models with lock icons on pro
- Clicking a locked model opens Privy login
- After login: sidebar appears, conversations work, model selector unlocks
- Brain button toggles memory pills
- Settings gear allows API key entry

- [ ] **Step 4: Commit**

```bash
git add chat/src/components/chat-interface.tsx
git commit -m "feat(chat): full chat interface with real streaming, sidebar, models, and memory"
```

---

## Task 15: Build & Deploy

**Files:**
- Modify: `chat/` (build output)

- [ ] **Step 1: Full build**

```bash
cd chat && npx vite build
```

Verify output in `src/verify-app/public/chat/`.

- [ ] **Step 2: Test production build locally**

Start the backend server and visit `http://localhost:3000/chat/`. Verify all features work against the real API.

- [ ] **Step 3: Commit build output**

```bash
git add src/verify-app/public/chat/
git commit -m "build: chat production build with full experience"
```

- [ ] **Step 4: Push**

```bash
git push
```

---

## Summary

| Task | What | Type |
|------|------|------|
| 1 | Model tier & cost fields | Backend |
| 2 | Guest remaining count in SSE | Backend |
| 3 | Memory IDs in SSE done event | Backend |
| 4 | Auto-register endpoint | Backend |
| 5 | Dependencies & config | Frontend setup |
| 6 | Types & API client | Frontend infra |
| 7 | Auth hook & context | Frontend infra |
| 8 | App shell & Privy provider | Frontend infra |
| 9 | Model selector component | Frontend UI |
| 10 | Chat hook & streaming | Frontend logic |
| 11 | Conversations hook | Frontend logic |
| 12 | Memory hook | Frontend logic |
| 13 | Sidebar (conversations + memory panel + import) | Frontend UI |
| 14 | Memory pills, rate limit, cost comparison, header | Frontend UI |
| 15 | ChatInterface full integration | Frontend UI |
| 16 | Build & deploy | DevOps |

**Note:** Tasks 1-4 (backend) can run in parallel. Tasks 5-8 are sequential. Tasks 9-14 depend on 5-8 but are independent of each other. Task 15 depends on all. Task 16 depends on 15.
