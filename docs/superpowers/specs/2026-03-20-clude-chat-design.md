# Clude Chat — Full Experience Design Spec

**Date:** 2026-03-20
**Status:** Approved
**Approach:** Chat-First Build (Approach 1)

---

## Overview

Wire the existing `/chat` SPA to the real backend and build the full chat experience: guest mode, Privy auth with auto-registration, conversation history, memory recall, model tiers, memory pack import, and a cost comparison showcase. The chat stays standalone at `/chat` — the dashboard links into it with auth carried over.

---

## 1. Authentication & API Key Flow

### Guest Flow
- User lands on `/chat` with no auth required.
- Chat connects to `POST /api/chat/guest` with `qwen3-5-9b`.
- 10 messages/day by IP. No sidebar, no conversation persistence.

### Privy Login Flow
- User clicks a locked model or a "Sign in" button in the chat header.
- Privy modal opens (wallet connect — same `PRIVY_APP_ID` as dashboard).
- On successful login, frontend sends Privy JWT to `POST /api/chat/auto-register`.
- Backend checks if a Cortex key exists for that wallet. If not, calls existing `/api/cortex/register` logic internally and returns the `clk_*` key.
- Frontend stores the key in localStorage and switches to authenticated mode.
- **Every user always gets a Cortex API key** — auto-created on first Privy login.

### Cortex Key Flow (Power Users)
- Settings/gear icon in chat header opens a panel to paste a `clk_*` key.
- Validates against backend, switches to that agent's memory corpus.

### Auth State in Requests
- Authenticated requests use `Authorization: Bearer clk_*` header.
- Works with existing `chatAuth` middleware — no backend auth changes needed.

### Session Management
- **On Privy login:** store Cortex key + wallet address in localStorage, clear any existing guest messages from state.
- **On Privy logout:** clear localStorage (Cortex key, wallet, endpoint), clear all in-memory state (conversations, messages, selected model), reset to guest mode.
- **On Cortex key switch:** full clear — wipe previous conversations from state, re-fetch for new key's corpus.
- **Tab reload:** check localStorage for existing key, validate against backend, resume auth or fall back to guest.
- **Expired Privy JWT:** Privy SDK auto-refreshes; if it fails, catch and trigger full logout + state clear.
- **Mode switch (Privy ↔ Cortex key):** full state reset between modes.

---

## 2. Model Selector & Tiers

### Model Registry
- Frontend fetches `GET /api/chat/models` on load (already exists).
- Each model gets a `tier` field: `"free"` or `"pro"`.
- **Free:** `qwen3-5-9b` only.
- **Pro:** all other 12 models (7 private + 5 anonymized).

### UI Behavior
- Dropdown shows all models grouped by privacy level (Private / Anonymized).
- Free model: normal styling, selectable by everyone.
- Pro models: greyed text, small lock icon, context window + privacy label still visible.
- Guest clicks a locked model → Privy login modal fires.
- After login, all models unlock, dropdown re-renders with full styling.
- Selected model persists in localStorage, defaults to `qwen3-5-9b`.
- Smooth dropdown with framer-motion spring transitions.
- Locked models get a subtle shimmer/glow effect on hover (shader-based).

### Backend Change
- Add `tier` field to the model registry in `chat-routes.ts` (one-line addition per model).
- No gating logic needed — existing auth middleware blocks unauthenticated conversation requests. Guest endpoint hardcoded to `qwen3-5-9b`.

---

## 3. Conversation History Sidebar

### Layout
- Left sidebar, ~260px wide, slides in from left on auth.
- Hidden entirely for guests (chat input centered, full width).
- Collapsible with a hamburger/chevron button.

### Sidebar Contents
- "New Chat" button at top.
- Conversations grouped by time: Today, Yesterday, Previous 7 Days, Older.
- Each item: title (auto-generated or "New conversation"), model icon, relative timestamp.
- Active conversation highlighted with PulsingBorder shader accent.
- Hover: subtle background shift + delete button appears.
- Staggered spring entrance animation on first render.

### Data Flow
- On auth, fetch `GET /api/chat/conversations?limit=50`.
- Selecting a conversation loads `GET /api/chat/conversations/:id` (last 50 messages).
- New chat: `POST /api/chat/conversations` with selected model.
- Messages sent via `POST /api/chat/conversations/:id/messages` (SSE streaming).
- Sidebar auto-updates when new conversations are created or title changes.

### Mobile
- Sidebar becomes an overlay drawer (slides over content).
- Swipe gesture to open/close.

### Your Memory Panel
- Below the conversation list, a collapsible "Your Memory" section.
- Compact summary: "42 memories" with a brain icon.
- Expanding reveals memory categories with counts: episodic, semantic, procedural, self-model.
- Each category expandable to show recent/top memories as one-line snippets.
- Click a memory snippet to see full content in a modal/flyout.
- "Import Pack" button — opens modal with file upload (drag-and-drop / picker for `.json`) or paste pack ID.
- "View in Dashboard" link opens `/dashboard` with wallet pre-authed.
- No memory editing/deletion in chat — stays in dashboard.
- Data: `GET /api/cortex/stats`, `GET /api/cortex/recent`, `POST /api/cortex/packs/import`.

---

## 4. Chat Message Flow & Streaming

### Guest Message Flow
1. User types message, hits send.
2. `POST /api/chat/guest` with `{ content, model: "qwen3-5-9b" }`.
3. SSE stream renders tokens in real-time with fluid typewriter.
4. Rate limit counter shown subtly: "7 of 10 free messages remaining".
5. At limit, input disables with "Sign in for unlimited" prompt.

### Authenticated Message Flow
1. User sends message in a conversation.
2. `POST /api/chat/conversations/:id/messages` with `{ content, model }`.
3. Backend recalls up to 10 memories, injects into system prompt.
4. SSE stream renders response.
5. On completion, response metadata includes `memory_ids` — frontend stores per message.
6. Brain button toggles memory annotations on all messages.
7. Conversation title auto-generates after first exchange.

### Streaming UX
- Tokens appear smoothly, no jarring chunks.
- Assistant avatar LiquidMetal shader animates faster while streaming, settles when done.
- Send button transforms to a stop button during streaming (cancel SSE).
- Input stays enabled but greyed during streaming — user can type ahead.

### Error Handling
- Network drop mid-stream: show last received content + "Response interrupted" notice + retry button.
- Rate limit hit: clear message with remaining time.
- Content filter triggered: "Message couldn't be processed" (no details leaked).

---

## 5. Brain Button & Memory Pack Import

### Brain Button (Bottom Bar)
- Default state: subtle icon, inactive.
- Toggle on: icon glows with blue shader accent, memory annotations appear on all assistant messages.
- Each annotation: collapsible pills below the message.
- Pill format: memory type icon (episodic/semantic/procedural/self-model) + truncated content + importance score.
- Click a pill to expand full memory content inline.
- WebGL micro-animation: brief neural-link burst when toggling on.

### Memory Pack Import (Sidebar Panel)
- Import button in "Your Memory" section opens modal.
- Two options: file upload (drag-and-drop / picker for `.json`) or paste pack ID.
- `POST /api/cortex/packs/import`.
- Success: brief animation, memory count updates, new memories available for recall immediately.
- Failure: clear error ("Invalid pack format", "Pack too large").

### Memory Context (Backend — Already Built)
- Memories injected as `<knowledge>`, `<behaviors>`, `<identity>`, `<recent>` XML sections.
- Frontend surfaces what was used via `memory_ids` in response metadata.

---

## 6. Cost Comparison Showcase

Display inference cost comparison in the chat UI to highlight Clude's value proposition — users get powerful models at a fraction of the cost of direct API access.

### Where It Appears
- In the model selector dropdown: small cost-per-message estimate next to each model.
- A dedicated "Cost" or "Compare" section accessible from the chat header or sidebar.
- After each response: optional subtle indicator showing estimated cost of that response.

### Comparison Data

| Provider | Model | Input (per 1M tokens) | Output (per 1M tokens) | Est. cost per message* |
|----------|-------|-----------------------|------------------------|------------------------|
| **Clude (Venice)** | qwen3-5-9b | ~$0.00 (free tier) | ~$0.00 | **Free** |
| **Clude (Venice)** | llama-3.3-70b | ~$0.20 | ~$0.20 | **~$0.0002** |
| **Clude (Venice)** | deepseek-v3.2 | ~$0.20 | ~$0.20 | **~$0.0002** |
| **OpenAI** | GPT-5.4 | $2.00 | $8.00 | **~$0.005** |
| **Anthropic** | Claude Opus 4.6 | $15.00 | $75.00 | **~$0.05** |

*Estimated per message assuming ~500 input tokens, ~500 output tokens.*

### Key Messaging
- "Chat with 13 models. Zero data retention. A fraction of the cost."
- Highlight that Venice private models have **zero data retention** — your prompts are never stored or trained on.
- Show the multiplier: "25x cheaper than GPT-5.4" / "250x cheaper than Claude Opus 4.6" for equivalent-class models.
- For the anonymized models (Claude, GPT, Grok via Venice): note that these are proxied through Venice with no user identity attached.

### Implementation
- Cost data stored in the model registry alongside existing metadata.
- Frontend renders a comparison card/tooltip when user hovers or clicks "Compare costs".
- Keep numbers up to date — pull from a config rather than hardcoding in UI.

---

## 7. Visual Polish & Animations

The chat should feel premium. Lean into the existing `@paper-design/shaders-react` library (LiquidMetal, PulsingBorder) and add Three.js/WebGL where impactful.

### Animation Touchpoints
- **Model selector:** Spring dropdown transitions (framer-motion). Locked models shimmer on hover.
- **Login transition:** Sidebar slides in with staggered reveal. Model locks dissolve with particle/fade effect.
- **Message streaming:** Fluid typewriter. Assistant avatar LiquidMetal pulses faster while streaming.
- **Brain button toggle:** Neural-network-style WebGL burst, then memory panel slides in.
- **Conversation sidebar:** Items enter with staggered spring animations. Active item has PulsingBorder accent.
- **Empty state:** Existing LiquidMetal orb welcome animation (keep as-is).
- **Memory import success:** Brief particle celebration animation.

### Where NOT to Overdo It
- No animations on actual message content (readability first).
- No heavy WebGL on conversation list (performance on long lists).
- Respect `prefers-reduced-motion` media query.

---

## 8. Architecture Summary

```
/chat (Vite SPA)
├── Privy auth (shared PRIVY_APP_ID with dashboard)
├── Auth hook (useAuth) — manages Privy + Cortex key + session lifecycle
├── Guest mode — /api/chat/guest (qwen3-5-9b, 10/day)
├── Auth mode — /api/chat/conversations/* (all models, unlimited)
├── Model selector — /api/chat/models (free/pro tiers)
├── Conversation sidebar (auth only)
│   ├── Conversation list (grouped by time)
│   └── Your Memory panel (stats, browse, import packs)
├── Chat area
│   ├── Message list with SSE streaming
│   ├── Memory annotations (Brain button toggle)
│   └── Cost indicator per response
└── Three.js/WebGL animations throughout

/dashboard (existing SPA)
└── Sidebar "Chat" link → /chat (auth carries over via Privy)

Backend changes:
├── POST /api/chat/auto-register — auto-create Cortex key on Privy login
├── GET /api/chat/models — add tier + cost fields to model registry
└── No other backend changes needed
```

---

## Out of Scope
- Link, Folder, Mic buttons — removed for now
- Memory editing/deletion in chat (stays in dashboard)
- Merging chat and dashboard into one app
- Voice input
- File upload
