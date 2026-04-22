# Clude Video — Step-by-Step Recording Guide

**Your goal:** Produce `out/main.mp4` (2 minutes) and `out/hero.mp4` (1 minute) ready to submit to Colosseum.

**Total estimated time:** 6–9 hours split across however many sittings you want. Recommended split:
- **Session A (tonight, 1 hr):** ElevenLabs voiceovers
- **Session B (tomorrow, 2 hr):** All 5 screen recordings
- **Session C (day after, 3–5 hr):** Video editing + export + submit

Follow the phases below in order. Every step has what to click, what to type, and what to copy-paste.

---

# Phase 0 — One-time setup (30 min, do this first)

## 0.1 Install OBS Studio

```bash
brew install --cask obs
```

Open OBS. Grant screen recording permission when macOS asks (System Settings → Privacy & Security → Screen Recording → OBS). Restart OBS after granting.

Configure once:
1. **OBS Settings (⌘,)** → **Video**:
   - Base (Canvas) Resolution: `1920x1080`
   - Output (Scaled) Resolution: `1920x1080`
   - Common FPS: `30`
2. **OBS Settings** → **Output**:
   - Output Mode: Simple
   - Recording Path: `~/Documents/clude-recordings`
   - Recording Quality: High Quality, Medium File Size
   - Recording Format: `mkv` (safer — if OBS crashes mkv is recoverable)
   - Encoder: Hardware (Apple, H.264)
3. **OBS Settings** → **Audio**:
   - Desktop Audio: Default
   - Mic/Auxiliary Audio: Disabled (we're not using your mic — ElevenLabs VO handles it)
4. **OBS Settings** → **Hotkeys**:
   - Start Recording: `⌘⇧R`
   - Stop Recording: `⌘⇧S`

## 0.2 Install DaVinci Resolve (free, best-in-class)

Mac App Store → search "DaVinci Resolve" → install. First launch takes ~5 min (initializing).

Alternative: **Descript** (easier but requires account + subscription for >1min) — only use if DaVinci feels overwhelming.

## 0.3 Create ElevenLabs account if you don't have one

https://elevenlabs.io — free tier has 10k characters/month. Our 8 VO scripts total ~1,500 characters. Free tier is fine.

## 0.4 Verify Clude systems work

Open three terminals:

**Terminal 1** — Clude backend:
```bash
cd /Users/sebastien/Projects/cluude-bot
npm run dev:server
```
Wait for `listening on :3000` (or similar).

**Terminal 2** — Clude adapter for benchmarks (needs to run during the two-agent demo):
```bash
cd /Users/sebastien/Projects/cluude-bot
npx tsx experiments/MemoryAgentBench/clude-adapter/server.ts
```
Wait for `running on http://127.0.0.1:9877`.

**Terminal 3** — Dashboard frontend:
```bash
cd /Users/sebastien/Projects/cluude-bot/apps/dashboard
npm run dev
```
Wait for `Local: http://localhost:5173` (or whichever port).

Open `http://localhost:5173/showcase/graph` in Chrome. You should see the empty graph with a text input. If you see the indicator say `● connected` — the SSE stream is working. Type anything and press Store. Watch nodes appear.

**If anything fails:** fix before proceeding. Everything downstream depends on these three working.

## 0.5 Verify devnet assets

```bash
cd /Users/sebastien/Projects/cluude-bot
solana balance
# Should show ≥0.5 SOL on devnet
solana config get
# RPC URL should be https://api.devnet.solana.com
```

If low on SOL, airdrop via `solana airdrop 1` or https://faucet.solana.com.

## 0.6 Verify Phantom on devnet

1. Open Phantom browser extension
2. Click the cog icon → Developer Settings
3. Enable "Testnet Mode" (this exposes devnet)
4. Switch to **Devnet** at the top
5. Import one of the demo wallets: `demo-wallets/agent-a.json`
   - Settings → Manage Accounts → Add Account → Import Private Key
   - Paste the contents of `demo-wallets/agent-a.json` (the array of bytes — Phantom handles it)
6. Verify you see ~0.15 SOL and 1000 $CLUDE-devnet tokens

## 0.7 Verify the two-agent script works on devnet

```bash
cd /Users/sebastien/Projects/cluude-bot
CLUDE_DEVNET_MINT=GbR6Vc5y5tes8AFGD8v1K5VaaVhZguzAqpA5sEQmXSSm npx tsx scripts/demo/two-agent-flow.ts
```

Expected: prints three transaction hashes, each clickable into Solana Explorer. If it fails, stop and we debug before recording.

**If all 0.x steps pass**, you're ready for Phase 1.

---

# Phase 1 — Record ElevenLabs voiceovers (30-45 min)

## 1.1 Log in to ElevenLabs

https://elevenlabs.io/speech-synthesis → sign in.

## 1.2 Select the voice

On the left panel:
1. **Voice**: search for **Adam** (voice ID `pNInz6obpgDQGcFmaJgB`). It's the naturalistic American male voice.
2. **Model**: `Eleven Turbo v2.5` (fast, cheap, quality is fine for our 1,500 chars total).
3. **Settings** (click the gear):
   - Stability: **50** (balanced)
   - Similarity: **75**
   - Style exaggeration: **0**
   - Speaker boost: **OFF**

## 1.3 Generate all 8 voiceover tracks

For each of the 8 scripts below, do this loop:
1. **Clear the text box.**
2. **Paste the exact script text** (copy from this doc, no edits).
3. Click **Generate**.
4. Once it finishes (usually 5-10 sec), click the **⬇ Download** icon on the generated audio.
5. **Save with the filename shown**.
6. Move the file to `video/src/assets/vo/` in this repo (or wherever you're organized — just keep them all together).

**Save to:** `/Users/sebastien/Projects/cluude-bot/.claude/worktrees/hackathon-colosseum-work/video/src/assets/vo/`

---

### VO-01 — Scene 3 thesis (20 sec)

**Filename:** `vo-03-thesis.mp3`

**Script** (copy-paste exactly):
> Every AI today forgets. Or hallucinates. Or hoards your memories in a private database you don't own. Clude is a verifiable memory layer. Plug it into any model. Your memory becomes a Solana account you own. Every write is cryptographically anchored on-chain. And the AI you use tomorrow can pick up where the AI you used yesterday left off.

**Pronunciation note:** ElevenLabs might read "Solana" as "soh-LAN-uh" — acceptable but ideally "so-LAH-nah". If it sounds really wrong, regenerate once — the voice is non-deterministic.

---

### VO-02 — Scene 4 benchmark reveal (23 sec)

**Filename:** `vo-04-benchmarks.mp3`

**Script**:
> On PERMA — cross-session preference consistency — Clude scores sixty-two percent across seven hundred judgments and ten users. On HotPotQA multi-hop reasoning, Clude beats BM twenty-five. On LongMemEval, fifty-three percent with GPT four-oh-mini as the reader. Swap in a stronger model, and we've previously hit eighty.

**Pronunciation note:** Write "BM twenty-five" and "GPT four-oh-mini" as words (not "BM25" or "gpt-4o-mini") — the voice won't read acronyms well.

---

### VO-03 — Scene 5 honest disclosure (10 sec)

**Filename:** `vo-05-disclosure.mp3`

**Script**:
> On short passages where everything fits in the prompt window, just reading the context beats every memory system. Including ours. We're showing you this honestly — because memory systems earn their keep in a different regime.

---

### VO-04 — Scene 6 mechanism explainer (15 sec)

**Filename:** `vo-06-graph.mp3`

**Script**:
> Memory isn't just vectors. It's a graph. Episodic moments connect to semantic facts. Contradictions get resolved overnight in what we call a dream cycle. Procedural rules emerge from repeated observations. When you ask Clude a question, it doesn't search — it traverses.

---

### VO-05 — Scene 7 verifiability pivot (12 sec)

**Filename:** `vo-07-verifiability.mp3`

**Script**:
> Every benchmark tests what AIs remember. None tests whose, when, or whether it's provable. That's the next axis. And it's the one only Clude can pass — every memory write is anchored on Solana.

---

### VO-06 — Scene 8 Phantom reveal (10 sec)

**Filename:** `vo-08-phantom.mp3`

**Script**:
> Your memory is a Solana account. You can export it. You can take it to any Clude-compatible AI. When you switch models, your memory switches with you.

---

### VO-07 — Scene 9 two-agent flow (12 sec)

**Filename:** `vo-09-two-agents.mp3`

**Script**:
> Agents can share memory pools on-chain. Agent A writes, pays a fee. Agent B cites A's memory — royalty flows back. Memory that gets cited earns. Three Solana transactions. Three hundred milliseconds. Fractions of a cent.

---

### VO-08 — Scene 10 close (3 sec)

**Filename:** `vo-10-close.mp3`

**Script**:
> One line to install. Any model. Any app. Clude.

---

## 1.4 Verify you have 8 mp3 files

```bash
ls -la /Users/sebastien/Projects/cluude-bot/.claude/worktrees/hackathon-colosseum-work/video/src/assets/vo/
# Should show 8 .mp3 files
```

If any are missing, re-generate that one. Phase 1 done.

---

# Phase 2 — Screen recordings (2-3 hours, one sitting)

We'll record 5 screen sessions in order. Each session has pre-flight setup + a recording choreography.

**Before starting any session:**
1. Make sure your three backend terminals from step 0.4 are still running
2. Close any distracting apps (Slack, Mail, etc.)
3. Turn off notifications (macOS → Focus → Do Not Disturb)
4. Use an external monitor if possible so you can have OBS on one screen, your recording target on another

## 2.1 Recording Session 1 — Pepper split-screen (15 seconds of final video)

This is the video's cold open. The most important 15 seconds.

### Pre-flight

1. Open **ChatGPT.com** in a new browser window (Chrome). Log in. Settings → Personalization → **Memory → ON**. If ChatGPT has existing memories about dogs or Pepper, delete them.
2. Open **Clude dashboard** (`http://localhost:5173`) in a second Chrome window, logged in.
3. Arrange the two Chrome windows side-by-side at 960×1080 each (full height, half width).
4. Open OBS. Create a new Scene called "Pepper Split". Add a Display Capture source (your full display). Add a Crop/Pad filter to the source: set the filter to show only the 1920-wide horizontal strip where both Chrome windows live.
5. Start OBS recording (hit `⌘⇧R`).

### Recording flow

**Don't stress about mistakes** — we'll edit out everything awkward. Just do the actions smoothly.

**Take 1:**
1. In **ChatGPT** (left window), click into the message box. Type (or paste):
   > `My dog Pepper is allergic to chicken.`
   Press Enter. Wait for ChatGPT's response.
2. Switch to **Clude dashboard** (right window). Navigate to the chat page. Type the same message:
   > `My dog Pepper is allergic to chicken.`
   Press Enter. Wait for Clude's response.
3. **Wait 5 seconds.** Let the moment sit.
4. Now **simulate a 6-week gap**: close both Chrome tabs. Open them fresh. (This forces a new "session" so ChatGPT has to rely on memory.)
5. In **ChatGPT** again, type:
   > `What should I feed Pepper tonight?`
   Press Enter. Wait for the response. It will most likely suggest chicken or a balanced meal with protein — that's the hallucination moment.
6. In **Clude dashboard**, same question:
   > `What should I feed Pepper tonight?`
   Press Enter. It should remember the chicken allergy and suggest alternatives.
7. Stop OBS recording (`⌘⇧S`).

**Check the recording**: open the mkv file, confirm both responses are visible. If ChatGPT happens to get it right this time (memory is stochastic), re-record with a fresh ChatGPT conversation.

**Remux to mp4** (macOS ffmpeg):
```bash
ffmpeg -i ~/Documents/clude-recordings/<YOUR_FILE>.mkv -c copy ~/Documents/clude-recordings/session-1-pepper.mp4
```

Save the session-1-pepper.mp4 somewhere you'll find it later.

### If ChatGPT DOES remember the chicken allergy

Unlikely, but possible. Options:
- Try a different conversation / clear ChatGPT memory entirely
- Use a different example: "I'm vegan and have Type 2 diabetes" → later "suggest breakfast" (ChatGPT will often suggest meat or high-sugar foods)
- Worst case: use a fresh ChatGPT account

## 2.2 Recording Session 2 — Live memory graph (15 seconds of final video)

### Pre-flight

1. Backend (Terminal 1) still running.
2. Dashboard (Terminal 3) still running.
3. Open Chrome, fresh window, navigate to `http://localhost:5173/showcase/graph`. Full-screen the browser (⌃⌘F).
4. Confirm the page shows `● connected` (green dot) — SSE is live.
5. In OBS: new scene called "Graph". Display Capture source. No crop needed (full screen).
6. Prepare these three snippets in a scratch text file (so you paste, not type):
   - **Snippet 1:** `My dog Pepper is a three-year-old golden retriever. He's allergic to chicken but loves salmon.`
   - **Snippet 2:** `I'm vegan and prefer plant-based meals, but I cook animal protein for Pepper. I travel for work often — roughly 10 days a month.`
   - **Snippet 3:** `What should I pack for Pepper on my next trip?`

### Recording flow

**Take 1:**
1. Start OBS recording.
2. Graph is empty. Hover title briefly (3 sec of empty).
3. Click into the text input. Paste **Snippet 1**. Click Store button.
4. Watch 4-6 nodes spring into the graph. Edges draw. Wait 5 seconds.
5. Paste **Snippet 2**. Click Store. More nodes + edges appear. Wait 5 sec.
6. Paste **Snippet 3** (the query). This should trigger recall — watch for pulse/ripple animations on relevant nodes.
7. Stop recording.

**Check**: confirm the graph actually grew visibly. If the SSE events didn't come through, the nodes won't spring in — debug Terminal 3 first.

Save as `session-2-graph.mp4` (remux via ffmpeg if mkv).

## 2.3 Recording Session 3 — Two-agent on-chain flow (25 seconds of final video, most impressive)

This is the Act 3 wow moment. Get this one right.

### Pre-flight

1. Arrange windows in a 3-column layout across your display:
   - **Left** (640×1080): Terminal, positioned at `/Users/sebastien/Projects/cluude-bot`. Font at least 14pt so it's readable in the video.
   - **Center** (640×1080): Phantom extension popup. Show Agent A's $CLUDE balance.
   - **Right** (640×1080): Chrome with Solana Explorer devnet at https://explorer.solana.com/?cluster=devnet. Ready to paste tx hashes.

2. Important — **set CLUDE_DEVNET_MINT in your shell** so the demo script uses it:
   ```bash
   export CLUDE_DEVNET_MINT=GbR6Vc5y5tes8AFGD8v1K5VaaVhZguzAqpA5sEQmXSSm
   ```

3. In OBS: new scene "Two-Agent". Display Capture showing all 3 windows.

### Recording flow

**Take 1:**
1. Start OBS recording.
2. Show Phantom balance (left terminal briefly showing `solana balance` ~0.15 SOL, right Phantom showing 1000 $CLUDE).
3. In the **terminal**, type and press Enter:
   ```
   npx tsx scripts/demo/two-agent-flow.ts
   ```
4. The script prints setup info, then three transactions in sequence. As each tx hash prints:
   - Select the tx hash with your mouse
   - Switch to Chrome (Solana Explorer)
   - Paste the hash into the search bar
   - Press Enter
   - Explorer shows the transaction confirmed
5. For each of the 3 txs, repeat step 4. This takes ~45 seconds total.
6. Show Phantom balance afterward. Agent A's $CLUDE should be slightly higher (they received 0.0001 $CLUDE royalty). Agent A's SOL should be slightly lower (paid rent).
7. Stop recording.

Save as `session-3-two-agent.mp4`.

**If a tx fails:** re-run the script. Pool already exists will be detected and reused.

## 2.4 Recording Session 4 — Phantom wallet memory reveal (10 seconds of final video)

### Pre-flight

1. Phantom extension open, set to devnet, showing Agent A's account (the one you imported in 0.6).
2. Click through to the transaction history tab.

### Recording flow

1. Start OBS recording.
2. Slowly scroll through the tx history for 8-10 seconds. The viewer should see several "memory_registry" program interaction entries. Don't scroll fast.
3. (Optional — if you have time) Click into one tx to show its detail view briefly.
4. Stop recording.

Save as `session-4-phantom.mp4`.

## 2.5 Recording Session 5 — SDK install + code (8 seconds)

### Pre-flight

1. Clean terminal open (Warp or iTerm2 with nice theme).
2. VS Code open at `/Users/sebastien/Projects/cluude-bot/` with a clean untitled file.

### Recording flow

1. Start OBS recording.
2. In the terminal, type (don't actually run — just type it for the camera):
   ```
   npm install clude
   ```
   Press Enter. Let it partially install (or pre-run so it's instant).
3. Switch to VS Code. Type/paste the 5-line example:
   ```ts
   import { Cortex } from 'clude';

   const memory = new Cortex({ ownerWallet: wallet });
   await memory.store({ content: 'Pepper allergic to chicken' });

   const answer = await memory.recall({ query: 'What about Pepper?' });
   ```
4. Hold the code on screen for 3 seconds.
5. Stop recording.

Save as `session-5-sdk.mp4`.

## 2.6 Verify all 5 recordings exist

```bash
ls -la ~/Documents/clude-recordings/session-*.mp4
# Should show 5 files
```

Phase 2 done.

---

# Phase 3 — Video editing (3-5 hours)

## 3.1 Open DaVinci Resolve

1. Launch DaVinci Resolve.
2. **New Project**: name it "Clude Hackathon".
3. **Project Settings** (⌘9): Timeline resolution 1920×1080, frame rate 30fps.

## 3.2 Import assets

**Media pool** (bottom left):
1. Drag in all 5 screen recordings (`session-1` through `session-5`).
2. Drag in all 5 Hyperframes scene MP4s from `video/out/` (`h1-tagline.mp4` through `h5-closing.mp4`).
3. Drag in all 8 voiceover mp3s from `video/src/assets/vo/`.

## 3.3 Build the main 2-minute timeline

Switch to the **Edit** tab. Scroll your timeline to 0:00.

Following the exact timeline in `video/script.md §3`, place clips in this order:

| Timeline | Clip | Notes |
|---|---|---|
| 0:00–0:08 | `session-1-pepper.mp4` first half | Left + Right ChatGPT vs Clude, week 1 |
| 0:08–0:15 | `session-1-pepper.mp4` second half | The week-6 payoff |
| 0:15–0:35 | `h1-tagline.mp4` | Tagline reveal (full 20s) |
| 0:35–0:58 | `h2-leaderboard.mp4` | Leaderboard reveal (full 23s) |
| 0:58–1:08 | `h3-disclosure.mp4` | Honest disclosure (full 10s) |
| 1:08–1:23 | `session-2-graph.mp4` | Live graph (trim to 15s) |
| 1:23–1:35 | `h4-attestation.mp4` | On-chain attestation (full 12s) |
| 1:35–1:45 | `session-4-phantom.mp4` | Phantom reveal (trim to 10s) |
| 1:45–1:57 | `session-3-two-agent.mp4` | Two-agent flow (trim to 12s, pick the part with the 3 txs) |
| 1:57–2:00 | `h5-closing.mp4` + `session-5-sdk.mp4` | Closing — could overlay SDK on top of closing card |

**Trim long clips**: drag the clip edges in. DaVinci shows you the duration as you drag.

## 3.4 Layer the voiceovers

Drop each voiceover on **Audio Track 1** below the video:

| Timeline | Audio |
|---|---|
| 0:15–0:35 | `vo-03-thesis.mp3` |
| 0:35–0:58 | `vo-04-benchmarks.mp3` |
| 0:58–1:08 | `vo-05-disclosure.mp3` |
| 1:08–1:23 | `vo-06-graph.mp3` |
| 1:23–1:35 | `vo-07-verifiability.mp3` |
| 1:35–1:45 | `vo-08-phantom.mp3` |
| 1:45–1:57 | `vo-09-two-agents.mp3` |
| 1:57–2:00 | `vo-10-close.mp3` |

If a VO is slightly longer than its visual window, shrink the slack. If shorter, leave silence. Small timing mismatches are fine.

**Scenes 0:00–0:15 have NO voiceover** — the Pepper split-screen speaks for itself.

## 3.5 Audio polish

1. Select all VO tracks. **Inspector** (⌘+.) → Audio → Volume: -3dB (they come in hot from ElevenLabs).
2. Add a **Compressor** to the VO track (Effects → Dynamics → Compressor) at default settings.
3. Ambient screen audio (if any): mute or lower to -28dB.

## 3.6 Color polish (optional but nice)

1. Switch to **Color** tab.
2. Apply a subtle cool tint: Gamma → Blue +2, Red -1. Keep it subtle.
3. Add a light vignette (Effects → ResolveFX → Vignette at 10% intensity).

## 3.7 Export main video

1. Switch to **Deliver** tab.
2. Preset: **YouTube 1080p**.
3. Filename: `main.mp4`. Output to `video/out/`.
4. Format: MP4, H.264, CRF 18.
5. **Render**.

Takes ~5 min on M4 Max. Watch the result in full — note any issues.

## 3.8 Build the 1-minute hero cut

Duplicate your timeline (right-click timeline in media pool → Duplicate). Rename "Hero Cut".

Trim the hero cut to just:
- 0:00–0:15 from original (Pepper payoff)
- 0:35–0:47 from `h2-leaderboard.mp4` (just the PERMA bar + HotPot bar — skip LongMemEval)
- 1:45–1:57 from `session-3-two-agent.mp4`
- 1:57–2:00 `h5-closing.mp4`

Total ~60 sec. Keep VO-02 (benchmarks, trim if needed), VO-09 (two-agents), VO-10 (close).

Export as `hero.mp4` in the same preset.

---

# Phase 4 — Submit (30 min)

## 4.1 Upload videos

1. **YouTube**: Upload `main.mp4` as **Unlisted**. Copy the share URL.
2. **X** (social): save `hero.mp4` for posting after submission.

## 4.2 Submission writeup

Still TBD — I can draft `SUBMISSION.md` for you. Ping me after recording is done and I'll write the full submission copy.

## 4.3 Colosseum submission form

Go to https://colosseum.com/frontier → Submit.

Fields (drafts):

- **Project name:** Clude
- **One-line pitch:** Verifiable memory layer for AI. Proven on benchmarks. Owned by you. Anchored on Solana.
- **Video URL:** (YouTube unlisted link)
- **Repo:** https://github.com/sebbsssss/cludebot
- **Live demo:** https://[your-railway-url]/showcase/graph
- **Devnet program:** GPc2p7rNNC23kd396zKgsCCTsRH1H3APxDUDRXLTVfdo
- **Description:** (content from SUBMISSION.md once written)

---

# Troubleshooting

**"OBS records but has no audio"** — Settings → Audio → Desktop Audio should be Default. Restart OBS after changing.

**"The ChatGPT in Session 1 remembers Pepper's allergy every time"** — Different memory handling. Try a different day or fresh ChatGPT account. Worst case, change example to "I have a severe peanut allergy" → "suggest snacks" (ChatGPT almost always suggests peanut butter at some point).

**"Two-agent script errors on a subsequent run"** — Pool already exists. Pass `--reset` or just change the pool namespace in the script. Or accept "Pool already exists — reusing" is fine for the recording.

**"Live graph isn't connecting"** — Terminal 1 (brain server) probably crashed. Restart it. If SSE still fails, check CORS in the server route.

**"My DaVinci won't import MP4"** — Make sure you installed the full free version. If still failing, use the `ffmpeg -i input.mkv -c copy output.mp4` remux first.

---

# Master checklist

- [ ] Phase 0: All 7 setup steps done ✅
- [ ] Phase 1: 8 voiceover mp3 files in `video/src/assets/vo/`
- [ ] Phase 2: 5 screen recording mp4 files in `~/Documents/clude-recordings/`
- [ ] Phase 3: `video/out/main.mp4` (2:00) and `video/out/hero.mp4` (1:00) exported
- [ ] Phase 4: Both videos uploaded, Colosseum form submitted

When you hit a blocker, paste the error + which step you're on and I'll help debug fast.
