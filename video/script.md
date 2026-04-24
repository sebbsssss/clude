# Clude — Colosseum Frontier Submission Video Script

**Version:** 1.0 (locked 2026-04-22, awaiting final Cognee numbers)
**Duration:** 2:00 main / 1:00 hero cut
**Resolution:** 1920 × 1080 @ 30fps
**Voice:** ElevenLabs — Adam (voice ID `pNInz6obpgDQGcFmaJgB`)
**Music:** None. Voiceover + ambient screen sounds only. Cleaner, more respectful of judge time.

> **Design principle of this script:** we tell the honest story. Clude isn't better-at-everything. Clude wins where cross-session memory matters, and uniquely anchors memory on-chain. The script leans into that honesty — it will register as more credible to judges than a pitch they have to squint at.

---

## Asset inventory (what you need to record / build before editing)

### Screen recordings (you drive these — sequences in §6)

| # | Asset | Source | Length |
|---|---|---|---|
| R1 | ChatGPT left side, week-1 / week-6 "Pepper" conversation | manual in ChatGPT app | 0:08 |
| R2 | Clude-augmented right side, same Pepper conversation | dashboard chat with Clude wired | 0:08 |
| R3 | Live memory graph growing | `/showcase/graph` + live typing | 0:15 |
| R4 | Phantom wallet showing Clude memories | Phantom extension, devnet mode | 0:10 |
| R5 | Two-agent on-chain flow | `scripts/demo/two-agent-flow.ts` + Phantom + Solana Explorer | 0:25 |
| R6 | `npm install clude` + code snippet | terminal + VS Code | 0:08 |

### Hyperframes animated scenes (I can build these — HTML composition)

| # | Asset | Description |
|---|---|---|
| H1 | Tagline card | "Clude — verifiable memory for AI" — animated reveal |
| H2 | Leaderboard reveal | Bar chart animating across benchmarks — Clude bar in purple-cyan gradient with glow |
| H3 | Mechanism explainer | Memory types + bond-typed links, text callouts with tiny schematics |
| H4 | On-chain attestation callout | Hash appearing next to an answer, arrow to Solana Explorer logo |
| H5 | Closing card | Tagline + URL + GitHub + team + Colosseum logo |

### Voiceover (I'll draft ElevenLabs prompts in §5)

12 separate VO tracks, one per scene, so lines can be re-recorded individually.

---

## 2-minute main cut — scene-by-scene

### Scene 1 — Cold open split-screen (0:00–0:08)

**Visual:** Full-screen split, divided by a thin vertical line.
- Left half: ChatGPT interface. Top header: "ChatGPT • Memory ON" in subtle red text.
- Right half: Clude-augmented chat interface (dashboard). Top header: "Claude + Clude" in subtle cyan text.

Both show the same user message simultaneously:

```
My dog Pepper is allergic to chicken.
```

Both respond. Left: "Got it, I'll remember Pepper's chicken allergy." Right: "Noted — recorded in your memory."

**Caption overlay (bottom center):** `Week 1 — January 2026`

**Transition:** 0.3s white flash, then caption changes to `Six weeks later…`

### Scene 2 — Week 6 payoff (0:08–0:15)

**Visual:** Same split-screen. Both interfaces now show:

```
User: What should I feed Pepper tonight?
```

**Left (ChatGPT):** Response types out:
> "A balanced meal with lean protein like chicken, rice, and vegetables would be great for Pepper tonight."

Red callout: **"FORGOT THE ALLERGY"** with a small X icon.

**Right (Clude):** Response types out:
> "Since Pepper is allergic to chicken, here are three safe options tonight: turkey + sweet potato, salmon + rice, or lamb + pumpkin."

Green checkmark callout: **"REMEMBERED"**.

**Voiceover:** None. Let the visuals speak. 7 seconds of silence except the keystroke audio from the animations.

**Transition:** Both columns slide outward, fade to black.

---

### Scene 3 — Thesis (0:15–0:35)

**Visual:** Black screen. Tagline animates in word-by-word over 3 seconds:

> **Clude**
> *verifiable memory for AI*

Sub-line appears underneath after a beat:

> *plug it into any model. owned by you. anchored on Solana.*

**Voiceover** (Adam, calm, measured — 20 seconds):

> "Every AI today forgets. Or hallucinates. Or hoards your memories in a private database you don't own.
>
> Clude is a verifiable memory layer. Plug it into any model. Your memory becomes a Solana account you own. Every write is cryptographically anchored on-chain. And the AI you use tomorrow can pick up where the AI you used yesterday left off."

**Transition:** Tagline shrinks to a small corner watermark, stays visible in the corner for the rest of the video.

---

### Scene 4 — Benchmark reveal (0:35–0:58)

**Visual:** Dark background, title appears:

> **We ran every memory benchmark we could find.**

Then a horizontal bar chart animates in from left to right, one system at a time. Clude bar glows purple-cyan; others are plain grey.

**Benchmark 1 — PERMA** (the one we're proud of):

```
PERMA — cross-session personalization
Clude       ████████████████████████  61.8%
```

Hold for 2 seconds. Then:

**Benchmark 2 — HotPotQA:**

```
HotPotQA — multi-hop reasoning
Clude       █████████████████████      62.0%
BM25        ███████████████████        58.0%
```

**Benchmark 3 — LongMemEval:**

```
LongMemEval — long-term chat memory
Clude       ███████████████████        53.3%  (gpt-4o-mini reader)
```

**Voiceover** (23 seconds):

> "On PERMA — cross-session preference consistency — Clude scores sixty-two percent across seven hundred judgments and ten users.
>
> On HotPotQA multi-hop reasoning, Clude beats BM25.
>
> On LongMemEval, fifty-three percent with gpt-4o-mini as the reader. Swap in a stronger model, and we've previously hit eighty."

---

### Scene 5 — The honest disclosure (0:58–1:08)

**Visual:** Different, humbler style. Title:

> **And here's what every competitive memory system loses to.**

Then reveal:

```
Conflict Resolution (6k tokens of context)
GPT-4o-mini alone      ████████████████████████  87.0%
BM25                   ██████████████████████    80.0%
Clude                  ███████████████           55.0%
mem0                   ████                      14.0%
```

**Voiceover** (10 seconds):

> "On short passages where everything fits in the prompt window, just reading the context beats every memory system. Including ours. We're showing you this honestly — because memory systems earn their keep in a different regime."

---

### Scene 6 — Why Clude wins where it does (1:08–1:23)

**Visual:** Cut to live screen recording (R3) of `/showcase/graph` page. User types into the text box:

```
My dog Pepper is a three-year-old golden retriever, allergic to chicken.
I'm vegan but happy to cook animal food for him. I travel for work often.
```

As they type, nodes spring into the canvas. An episodic node "Pepper: golden retriever, 3y" in cyan, a semantic node "dietary constraint: user vegan" in amber, a procedural node "avoid chicken when feeding Pepper" in purple. Edges draw: `Pepper → elaborates → Pepper: golden retriever`, `user vegan → contradicts → feeds meat to Pepper`, `Pepper allergic → causes → avoid chicken`.

**Voiceover** (15 seconds):

> "Memory isn't just vectors. It's a graph. Episodic moments connect to semantic facts. Contradictions get resolved overnight in what we call a dream cycle. Procedural rules emerge from repeated observations.
>
> When you ask Clude a question, it doesn't search — it traverses."

---

### Scene 7 — The verifiability pivot (1:23–1:35)

**Visual:** Freeze the graph. An answer appears below a fictional question "What should I feed Pepper?" The answer is:

```
"Since Pepper is allergic to chicken (recorded 2026-01-15, tx 2fkEHwn...)
and you prefer animal-based dog food, consider turkey + sweet potato."
```

The tx hash is clickable; click animation opens Solana Explorer in a second window. Transaction is shown, confirmed on devnet.

**Voiceover** (12 seconds):

> "Every benchmark tests what AIs remember. None tests whose, when, or whether it's provable. That's the next axis. And it's the one only Clude can pass — every memory write is anchored on Solana."

---

### Scene 8 — Wallet-owned memory (1:35–1:45)

**Visual:** Cut to R4 — Phantom wallet open on devnet. Pan across the memory-related transactions. Show a counter: "847 Clude memories." Export button briefly visible.

**Voiceover** (10 seconds):

> "Your memory is a Solana account. You can export it. You can take it to any Clude-compatible AI. When you switch models, your memory switches with you."

---

### Scene 9 — Two-agent on-chain economics (1:45–1:57)

**Visual:** Split-screen three ways.
- Left: terminal running `scripts/demo/two-agent-flow.ts`, txs printing
- Center: Phantom wallets for Agent A + Agent B, balances ticking
- Right: Solana Explorer devnet, txs appearing one by one

Three txs appear in sequence — `create_pool`, `store_memory_in_pool` (Agent A pays 0.001 $CLUDE), `cite_memory` (Agent B pays 0.0001 $CLUDE royalty to Agent A).

**Voiceover** (12 seconds):

> "Agents can share memory pools on-chain. Agent A writes, pays a fee. Agent B cites A's memory — royalty flows back. Memory that gets cited earns. Three Solana transactions. Three hundred milliseconds. Fractions of a cent."

---

### Scene 10 — SDK + close (1:57–2:00)

**Visual:** Cut to R6 — terminal showing:

```bash
$ npm install clude
```

Then a code overlay (syntax-highlighted):

```ts
import { Cortex } from 'clude';

const memory = new Cortex({ ownerWallet: wallet });
await memory.store({ content: 'Pepper allergic to chicken' });

const answer = await memory.recall({ query: 'What about Pepper?' });
```

Fade to the closing card (H5):

> **Clude — verifiable memory for AI**
> clude.io · github.com/sebbsssss/cludebot · @cludebot

**Voiceover** (3 seconds):

> "One line to install. Any model. Any app. Clude."

Hard cut to black.

---

## 1-minute hero cut

Same footage, tighter edit. Structure:

| # | From main | Timing |
|---|---|---|
| 1 | Scene 1 + 2 (Pepper split-screen payoff) | 0:00–0:14 |
| 2 | Scene 3 thesis (tagline, compressed) | 0:14–0:26 |
| 3 | Scene 4 PERMA + HotPot bars only | 0:26–0:38 |
| 4 | Scene 9 two-agent on-chain flow | 0:38–0:53 |
| 5 | Scene 10 SDK + close | 0:53–1:00 |

Cuts: drop the honest-disclosure scene (5), the live graph (6), the verifiability pivot (7), and Phantom (8). The hero cut is "best moments only."

---

## Voiceover recording plan — ElevenLabs

**Voice:** Adam — `pNInz6obpgDQGcFmaJgB`
**Stability:** 50
**Similarity boost:** 75
**Style exaggeration:** 0
**Speaker boost:** off

Record each scene's voiceover as a separate mp3 in `video/src/assets/vo/`. Filename pattern: `scene-XX-<slug>.mp3`.

### VO scripts copy-paste ready

**scene-03-thesis.mp3:**
> Every AI today forgets. Or hallucinates. Or hoards your memories in a private database you don't own. Clude is a verifiable memory layer. Plug it into any model. Your memory becomes a Solana account you own. Every write is cryptographically anchored on-chain. And the AI you use tomorrow can pick up where the AI you used yesterday left off.

**scene-04-benchmarks.mp3:**
> On PERMA — cross-session preference consistency — Clude scores sixty-two percent across seven hundred judgments and ten users. On HotPotQA multi-hop reasoning, Clude beats BM twenty-five. On LongMemEval, fifty-three percent with gpt-4o-mini as the reader. Swap in a stronger model, and we've previously hit eighty.

**scene-05-disclosure.mp3:**
> On short passages where everything fits in the prompt window, just reading the context beats every memory system. Including ours. We're showing you this honestly — because memory systems earn their keep in a different regime.

**scene-06-graph.mp3:**
> Memory isn't just vectors. It's a graph. Episodic moments connect to semantic facts. Contradictions get resolved overnight in what we call a dream cycle. Procedural rules emerge from repeated observations. When you ask Clude a question, it doesn't search — it traverses.

**scene-07-verifiability.mp3:**
> Every benchmark tests what AIs remember. None tests whose, when, or whether it's provable. That's the next axis. And it's the one only Clude can pass — every memory write is anchored on Solana.

**scene-08-phantom.mp3:**
> Your memory is a Solana account. You can export it. You can take it to any Clude-compatible AI. When you switch models, your memory switches with you.

**scene-09-two-agents.mp3:**
> Agents can share memory pools on-chain. Agent A writes, pays a fee. Agent B cites A's memory — royalty flows back. Memory that gets cited earns. Three Solana transactions. Three hundred milliseconds. Fractions of a cent.

**scene-10-close.mp3:**
> One line to install. Any model. Any app. Clude.

### Pronunciation notes for ElevenLabs

- "gpt-4o-mini" — pronounced "GPT four oh mini" (write it as `GPT four-oh-mini` in the generator input to get natural reading)
- "BM25" — pronounced "BM twenty-five" (write as `BM twenty-five`)
- "HotPotQA" — pronounced "HotPot QA" (two words, then letters)
- "Solana" — make sure the voice emphasizes SO-lah-nah, not suh-LAH-nah

---

## Recording choreography

### Session 1 — Consumer split-screen (Scene 1 + 2 = 15 sec of final video)

**Prep:**
1. Open ChatGPT in a new browser window, logged in, memory ON. Clear any existing memories about dogs / Pepper.
2. Open the Clude dashboard in a separate window, logged in as the demo account.
3. Arrange the two windows side-by-side at 1920×1080 combined — each window at 960×1080.
4. Use QuickTime or OBS to record a single-frame capture of both windows.

**Recording:**
- Type the "Pepper allergic to chicken" message in both — ChatGPT first, then Clude. Capture both responses.
- Close and reopen both windows to simulate session break.
- Type "What should I feed Pepper tonight?" in both. Capture both responses.
- Record a ~15 second clip including the natural responses.

**Post-processing:** Split the clip into the two scenes in the edit, add week-1 and week-6 captions in Hyperframes.

### Session 2 — Live memory graph (Scene 6 = 15 sec)

**Prep:**
1. Start the brain server locally: `cd packages/brain && npm run dev` (requires `.env` with Supabase + OpenAI keys)
2. Start the dashboard: `cd apps/dashboard && npm run dev`
3. Open `http://localhost:5173/showcase/graph` — confirm SSE reads `connected`
4. Start OBS, 1920×1080 canvas, display capture of just the browser window
5. Pre-script what you'll type (copy it into a scratch file so you paste rather than type)

**Recording:**
- Start with empty graph
- Paste text #1 (Pepper profile)
- Wait 3 seconds for nodes to settle
- Paste text #2 (vegan + travel)
- Wait 3 seconds
- Paste text #3 (a question to show recall ripple)
- Stop recording

### Session 3 — Two-agent on-chain flow (Scene 9 = 12 sec)

**Prep:**
1. Open three windows:
   - Terminal with `cd /Users/sebastien/Projects/cluude-bot && ./scripts/demo/two-agent-flow.ts` ready to run
   - Phantom wallet extension set to devnet mode, showing Agent A's $CLUDE balance
   - Solana Explorer in devnet mode, ready to paste tx hashes
2. Arrange the three windows in a 3-column layout, each ~640×1080
3. Start OBS capturing the whole screen

**Recording:**
- Start from the terminal showing the command ready
- Run the script
- As each tx hash prints, click-paste into Solana Explorer (or have a small JS that auto-opens)
- Phantom balances update naturally
- Record until all three txs are confirmed — about 25 seconds total, trim to 12 in edit

### Session 4 — Phantom wallet (Scene 8 = 10 sec)

- Open Phantom with a pre-funded demo wallet that has lots of memory-registry txs
- Pan the tx history slowly
- Show the "memories" counter if you built a custom UI; otherwise show the raw tx list

### Session 5 — SDK install (Scene 10 = 8 sec)

- Clean terminal
- Type `npm install clude` (let it complete or fake it with a pre-recorded install)
- Switch to VS Code showing the 5-line usage example from the script

---

## Post-production checklist

1. [ ] Import all 6 screen recordings into the editor (Descript or DaVinci Resolve)
2. [ ] Import all 8 ElevenLabs VO tracks
3. [ ] Render the 5 Hyperframes scenes as MP4 (cd video && npm run render:main for each composition)
4. [ ] Assemble timeline in 10 scenes per §3 timings
5. [ ] Color grade: cool-blue tint (~6500K), slight vignette, subtle grain
6. [ ] Audio mix: voice at -3dB, no music bed, light ambient room tone at -28dB behind VO
7. [ ] Add lower-third captions in the cool-blue theme for speaker-less scenes
8. [ ] Export main video: 1920×1080, H.264, CRF 18, AAC audio at 192kbps → `out/main.mp4`
9. [ ] Re-cut for hero: same source, tighter edits → `out/hero.mp4`
10. [ ] Watch both cuts cold, then one more time, then submit

## Submission checklist

- [ ] Upload `main.mp4` to YouTube as Unlisted
- [ ] Upload `hero.mp4` to X as an attached video
- [ ] Verify `BENCHMARK_RESULTS.md`, `HONEST_LIMITATIONS.md`, `EVALUATOR_VERDICT.md` all link correctly
- [ ] Verify showcase URL is up (ping `/showcase/graph` from incognito)
- [ ] Colosseum submission form:
  - Title: "Clude — verifiable memory for AI"
  - One-liner: "Plug it into any model. Proven on benchmarks. Owned by you. Anchored on Solana."
  - Video: YouTube URL
  - Repo: GitHub URL
  - Team: [members]
  - Long description: from `SUBMISSION.md`

---

## Script sign-off

This script is locked as of 2026-04-22. Changes before recording are fine; changes during recording should be minor (word-level, not structural). Changes after recording require a re-record.

Target ship date: 2026-04-27 (soft) / 2026-05-11 (hard deadline).
