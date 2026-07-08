/**
 * Ansem Guest Page — a bull-shaped memory constellation + "Speak to Ansem" chat.
 * Self-contained, no auth. Public page impersonating-in-voice a real person:
 * the "AI clone — not the real person · not financial advice" disclaimer is non-negotiable.
 *
 * The canvas render engine is ported VERBATIM in look from scratchpad/bull.html
 * (additive-glow render, depth/parallax starfield, vignette, pre-rendered glow
 * sprites, point-in-path bull silhouette, hover tooltips). The ONLY change is that
 * it is fed live node data instead of the baked DATA blob, and chat recall
 * highlights nodes by id.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ansemApi } from '../lib/ansem-api';
import type { AnsemNode } from '../lib/ansem-api';
import { AvatarBull } from '../components/AvatarBull';
import type { AvatarBullHandle } from '../components/AvatarBull';
import { AnsemFeed } from '../components/AnsemFeed';
import { BullSwarm3D } from '../components/BullSwarm3D';
import type { BullNode } from '../components/BullSwarm3D';

// ── Data fetching ───────────────────────────────────────────────────────────

function useAnsemData() {
  const [nodes, setNodes] = useState<AnsemNode[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await ansemApi.getMemoryGraph();
        if (!cancelled) {
          setNodes(result.nodes);
          setTotal(result.total || result.nodes.length);
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load graph');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { nodes, total, loading, error };
}

// ── Bull constellation (verbatim render engine from bull.html) ──────────────
//
// Every visual constant, sprite, silhouette path, depth bucket, parallax offset,
// additive composite and fade-in is preserved from bull.html. The engine reads
// live nodes: node brightness/size ∝ likes; `highlightIds` pulses recalled nodes.

// SIL nodes carry a data id back to React for hover + highlight.
interface StarNode {
  x: number; y: number; z: number;
  out: boolean; bright: boolean;
  r: number; ph: number;
  glow?: boolean; g?: boolean; a?: number; sp?: number;
  id?: number; t?: string; l?: number;
  // live-stream nodes carry their 1000-space anchor (to re-place on resize) + birth time
  qx?: number; qy?: number; born?: number;
}

function BullConstellation({
  nodes,
  highlightIds,
}: {
  nodes: AnsemNode[];
  highlightIds: Set<number>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  // highlight set is read inside the rAF loop without re-subscribing it
  const highlightRef = useRef<Set<number>>(highlightIds);
  highlightRef.current = highlightIds;
  const nodesRef = useRef<AnsemNode[]>(nodes);
  nodesRef.current = nodes;
  // View transform (zoom + pan). Mutated by wheel/drag handlers, read in the rAF
  // loop AND in the hit-test so tooltips stay correct under zoom. Kept in a ref
  // (not state) so panning/zooming never re-runs the build effect.
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 });

  // Live X posts streamed into the constellation as new igniting stars. The render
  // effect publishes an "add" fn here; this poll (server-cached — shares AnsemFeed's
  // data, so no extra X cost) feeds it new posts every 90s. animate=false on the first
  // batch (they seed the field), true after (genuinely-new posts ignite in).
  const addLiveRef = useRef<((posts: Array<{ id: string; text: string; likes: number }>, animate: boolean) => void) | null>(null);
  useEffect(() => {
    let stop = false;
    const seen = new Set<string>();
    let first = true;
    const poll = async () => {
      try {
        const data = await ansemApi.getFeed();
        if (stop || !data.enabled || !Array.isArray(data.posts)) return;
        const fresh = data.posts.filter((p) => !seen.has(p.id));
        fresh.forEach((p) => seen.add(p.id));
        if (fresh.length) addLiveRef.current?.(fresh.map((p) => ({ id: p.id, text: p.text, likes: p.likes })), !first);
        first = false;
      } catch { /* transient — retry next tick */ }
    };
    poll();
    const iv = window.setInterval(poll, 90_000);
    return () => { stop = true; window.clearInterval(iv); };
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    const tip = tipRef.current;
    if (!wrap || !cv || !tip) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── bull silhouette parts (identical paths to bull.html) ─────────────────
    const PARTS = [
      // face / shield
      'M320,436 C352,402 442,392 500,394 C558,392 648,402 680,436 ' +
      'C704,512 686,606 632,700 C590,800 548,852 500,882 ' +
      'C452,852 410,800 368,700 C314,606 296,512 320,436 Z',
      // left horn
      'M360,430 C250,430 132,392 70,300 C40,255 30,205 44,180 ' +
      'C64,170 92,196 120,236 C170,306 250,360 372,404 ' +
      'C440,428 470,470 470,470 C430,452 392,440 360,430 Z',
      // right horn
      'M640,430 C750,430 868,392 930,300 C960,255 970,205 956,180 ' +
      'C936,170 908,196 880,236 C830,306 750,360 628,404 ' +
      'C560,428 530,470 530,470 C570,452 608,440 640,430 Z',
      // left ear — protrudes OUT from the cheek (overlaps the face edge → union)
      'M335,480 C275,462 222,492 228,542 C262,570 312,562 340,542 Z',
      // right ear
      'M665,480 C725,462 778,492 772,542 C738,570 688,562 660,542 Z',
    ].map((d) => new Path2D(d));

    // identity-transform context purely for point-in-path tests (1000-space)
    const tcv = document.createElement('canvas');
    tcv.width = tcv.height = 1000;
    const tctx = tcv.getContext('2d')!;
    const inside = (x: number, y: number): boolean => {
      for (const p of PARTS) { if (tctx.isPointInPath(p, x, y)) return true; }
      return false;
    };

    // ── split live nodes into BRIGHT (most-liked, bloom) + FAINT (interior) ──
    // Mirror the bull's baked "bright = most-liked" split, derived from likes.
    const src = [...nodesRef.current].sort((a, b) => (b.likes || 0) - (a.likes || 0));
    const NBRIGHT = Math.min(48, Math.max(2, Math.round(src.length * 0.02)));
    const BRIGHT = src.slice(0, NBRIGHT);
    const FAINT = src.slice(NBRIGHT);
    const maxL = Math.max(1, ...BRIGHT.map((b) => b.likes || 0));

    // ── glow sprites (pre-rendered; drawn additively) ────────────────────────
    function sprite(stops: Array<[number, string]>): HTMLCanvasElement {
      const s = document.createElement('canvas');
      s.width = s.height = 128;
      const g = s.getContext('2d')!;
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      return s;
    }
    const SPR_STAR = sprite([[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(214,255,228,0.9)'], [0.3, 'rgba(92,240,138,0.45)'], [0.62, 'rgba(40,180,90,0.12)'], [1, 'rgba(40,180,90,0)']]);
    const SPR_GLOW = sprite([[0, 'rgba(120,255,170,0.65)'], [0.35, 'rgba(60,224,120,0.28)'], [1, 'rgba(60,224,120,0)']]);
    const SPR_DOT = sprite([[0, 'rgba(235,255,242,0.9)'], [0.4, 'rgba(160,240,190,0.25)'], [1, 'rgba(160,240,190,0)']]);

    let W = 0, H = 0, S = 0, OX = 0, OY = 0, DPR = 1;
    const mkRnd = () => { let s = 20240704; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); };
    const toCanvas = (x: number, y: number): [number, number] => [OX + x / 1000 * S, OY + y / 1000 * S];
    const to1000 = (cx: number, cy: number): [number, number] => [(cx - OX) / S * 1000, (cy - OY) / S * 1000];
    const zBucket = (z: number): number => (z < 0.55 ? 0 : z < 0.8 ? 1 : 2);

    let nodes: StarNode[] = [];
    let dataNodes: StarNode[] = [];
    let edgeLayers: Array<{ cv: HTMLCanvasElement }> = [];
    // live X posts streamed in as new stars — kept across rebuilds, re-anchored on resize
    const live: StarNode[] = [];
    const seenLive = new Set<string>();
    let liveIdSeq = -1;
    const LIVE_CAP = 22;

    // Place each new post at a random point inside the bull; it ignites (bloom + ring)
    // for ~2s then settles into a faint, hoverable field star. Oldest evicted past cap.
    function addLivePosts(posts: Array<{ id: string; text: string; likes: number }>, animate: boolean) {
      if (S <= 0) return;                       // not laid out yet; next poll will catch it
      for (const p of posts) {
        if (seenLive.has(p.id)) continue;
        seenLive.add(p.id);
        let qx = 500, qy = 550, g = 0;
        do { qx = Math.random() * 1000; qy = Math.random() * 1000; g++; } while (!inside(qx, qy) && g < 80);
        const [cx, cy] = toCanvas(qx, qy);
        const n: StarNode = {
          x: cx, y: cy, qx, qy, z: 0.86, out: false, bright: false,
          r: 1.6 + Math.min(3.4, (p.likes || 0) * 0.5), ph: Math.random() * 6.28, sp: 0.7 + Math.random() * 1.1,
          id: liveIdSeq--, t: p.text, l: p.likes,
          born: animate ? performance.now() : performance.now() - 6000, // past → no birth flash on seed
        };
        live.push(n); dataNodes.push(n);
      }
      while (live.length > LIVE_CAP) {
        const old = live.shift();
        if (old) { const di = dataNodes.indexOf(old); if (di >= 0) dataNodes.splice(di, 1); }
      }
    }
    addLiveRef.current = addLivePosts;

    function build() {
      const rnd = mkRnd(); nodes = []; dataNodes = [];

      // 1) background starfield — the bull emerges FROM a field of stars
      const NBG = Math.round(520 * (W * H) / (1440 * 900));
      for (let i = 0; i < NBG; i++) {
        const cx = rnd() * W, cy = rnd() * H;
        const [qx, qy] = to1000(cx, cy);
        if (qx >= 0 && qx <= 1000 && qy >= 0 && qy <= 1000 && inside(qx, qy)) { i--; continue; }
        const big = rnd() < 0.08;
        nodes.push({
          x: cx, y: cy, z: 0.3 + rnd() * 0.22, out: true, bright: false,
          r: big ? (1.6 + rnd() * 1.4) : (0.5 + rnd() * 0.9), glow: big,
          g: rnd() < 0.45, a: big ? (0.4 + rnd() * 0.3) : (0.10 + rnd() * 0.26),
          ph: rnd() * 6.28, sp: 0.4 + rnd() * 1.0,
        });
      }

      // 2) interior data stars (real memories, hoverable)
      for (const d of FAINT) {
        let x = 0, y = 0, g = 0;
        do { x = rnd() * 1000; y = rnd() * 1000; g++; } while (!inside(x, y) && g < 80);
        const [cx, cy] = toCanvas(x, y);
        const near = !inside(x - 9, y) || !inside(x + 9, y) || !inside(x, y - 9) || !inside(x, y + 9);
        const n: StarNode = {
          x: cx, y: cy, z: 0.45 + rnd() * 0.45, out: false, bright: false, id: d.id, t: d.content, l: d.likes,
          r: (near ? 1.5 : 0.95) + rnd() * 1.0, g: rnd() < (near ? 0.75 : 0.5),
          a: (near ? 0.5 : 0.34) + rnd() * 0.4, ph: rnd() * 6.28, sp: 0.6 + rnd() * 1.4,
        };
        nodes.push(n); dataNodes.push(n);
      }

      // 3) interior FILLER stars — densify the mesh, boundary-biased (rim light)
      const NFILL = Math.round(1200 * Math.min(1.35, (W * H) / (1440 * 900)));
      let placed = 0, guard = 0;
      while (placed < NFILL && guard < NFILL * 50) {
        guard++;
        const x = rnd() * 1000, y = rnd() * 1000;
        if (!inside(x, y)) continue;
        const near = !inside(x - 10, y) || !inside(x + 10, y) || !inside(x, y - 10) || !inside(x, y + 10);
        if (!near && rnd() < 0.45) continue;           // bias toward the outline
        const [cx, cy] = toCanvas(x, y);
        nodes.push({
          x: cx, y: cy, z: 0.35 + rnd() * 0.5, out: false, bright: false,
          r: (near ? 1.3 : 0.8) + rnd() * 0.9, g: rnd() < (near ? 0.8 : 0.5),
          a: (near ? 0.45 : 0.25) + rnd() * 0.35, ph: rnd() * 6.28, sp: 0.6 + rnd() * 1.5,
        });
        placed++;
      }

      // 4) bright memory-stars (the most-liked posts — bloom).
      // His TWO most-liked memories are pinned as the bull's EYES.
      const EYES: Array<[number, number]> = [[420, 534], [580, 534]];
      BRIGHT.forEach((d, bi) => {
        let x = 0, y = 0, g = 0;
        if (bi < 2) { x = EYES[bi][0]; y = EYES[bi][1]; }
        else { do { x = rnd() * 1000; y = rnd() * 1000; g++; } while (!inside(x, y) && g < 80); }
        const [cx, cy] = toCanvas(x, y);
        const pop = (d.likes || 0) / maxL;
        const n: StarNode = {
          x: cx, y: cy, z: bi < 2 ? 1 : 0.72 + 0.28 * Math.pow(pop, 0.4), out: false, bright: true, id: d.id, t: d.content, l: d.likes,
          r: bi < 2 ? Math.max(9.5, 2.2 + 8.2 * Math.pow(pop, 0.5)) : 2.2 + 8.2 * Math.pow(pop, 0.5), ph: rnd() * 6.28,
        };
        nodes.push(n); dataNodes.push(n);
      });

      // ── constellation mesh: pre-rendered per z-bucket (parallax layers) ─────
      edgeLayers = [];
      for (let b = 0; b < 3; b++) {
        const layer = document.createElement('canvas'); layer.width = cv!.width; layer.height = cv!.height;
        const lc = layer.getContext('2d')!; lc.setTransform(DPR, 0, 0, DPR, 0, 0);
        edgeLayers.push({ cv: layer });
        const bucketNodes = nodes.map((n, i) => ({ n, i })).filter((o) => zBucket(o.n.z) === b);
        const cell = Math.max(16, S * 0.034);
        const grid: Record<string, Array<{ n: StarNode; i: number }>> = {};
        bucketNodes.forEach((o) => { const k = ((o.n.x / cell) | 0) + ',' + ((o.n.y / cell) | 0); (grid[k] || (grid[k] = [])).push(o); });
        const Rin = S * 0.052, Rout = S * 0.055;
        lc.lineWidth = 0.6;
        bucketNodes.forEach((o) => {
          const n = o.n, R = n.out ? Rout : Rin, R2 = R * R, cap = n.out ? 2 : 4;
          const gx = (n.x / cell) | 0, gy = (n.y / cell) | 0; let cnt = 0;
          for (let dx = -1; dx <= 1 && cnt < cap; dx++) for (let dy = -1; dy <= 1 && cnt < cap; dy++) {
            const c = grid[(gx + dx) + ',' + (gy + dy)]; if (!c) continue;
            for (const p of c) {
              if (p.i <= o.i) continue; const m = p.n;
              if (m.out !== n.out) continue;            // never bridge the silhouette
              const d2 = (n.x - m.x) ** 2 + (n.y - m.y) ** 2;
              if (d2 < R2) {
                const base = n.out ? 0.05 : 0.10;
                const a = base + (1 - Math.sqrt(d2) / R) * (n.out ? 0.09 : 0.20);
                lc.strokeStyle = 'rgba(72,232,132,' + a + ')';
                lc.beginPath(); lc.moveTo(n.x, n.y); lc.lineTo(m.x, m.y); lc.stroke();
                if (++cnt >= cap) break;
              }
            }
          }
        });
      }
    }

    function resize() {
      DPR = Math.min(2, window.devicePixelRatio || 1);
      W = wrap!.clientWidth; H = wrap!.clientHeight;
      cv!.width = Math.round(W * DPR); cv!.height = Math.round(H * DPR); cv!.style.width = W + 'px'; cv!.style.height = H + 'px';
      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      S = Math.min(W, H) * 0.92; OX = (W - S) / 2; OY = (H - S) / 2 + H * 0.012;
      // A viewport resize re-fits the constellation → reset zoom/pan to identity.
      viewRef.current = { scale: 1, ox: 0, oy: 0 };
      build();
      // re-anchor streamed-in live nodes (build() cleared dataNodes; coords depend on S/OX/OY)
      for (const n of live) { const [cx, cy] = toCanvas(n.qx as number, n.qy as number); n.x = cx; n.y = cy; dataNodes.push(n); }
    }

    // parallax (smoothed) — nearer layers drift more: real depth
    let txp = 0, typ = 0, pxp = 0, pyp = 0;
    const bucketOff = (b: number): [number, number] => { const k = [5, 11, 19][b]; return [pxp * k, pyp * k * 0.66]; };

    const t0 = performance.now();
    let raf = 0;
    function frame(now: number) {
      const t = reduce ? 0 : (now - t0) / 1000;
      if (!reduce) { pxp += (txp - pxp) * 0.045; pyp += (typ - pyp) * 0.045; }
      const hl = highlightRef.current;
      const hasHl = hl.size > 0;
      const vw = viewRef.current;                          // {scale, ox, oy} zoom+pan
      const vs = vw.scale, vox = vw.ox, voy = vw.oy;
      ctx!.clearRect(0, 0, W, H);
      ctx!.globalCompositeOperation = 'lighter';           // additive light — the glow look
      // Edge layers are full-canvas images; scale+offset them with the view transform.
      for (let b = 0; b < 3; b++) { const [ox, oy] = bucketOff(b); ctx!.drawImage(edgeLayers[b].cv, ox * vs + vox, oy * vs + voy, W * vs, H * vs); }
      for (const n of nodes) {
        const [ox, oy] = bucketOff(zBucket(n.z));
        // world position (parallax) → screen position (zoom+pan)
        const x = (n.x + ox) * vs + vox, y = (n.y + oy) * vs + voy;
        // chat→highlight: recalled memories pulse + enlarge + brighten; rest dim.
        const isHl = hasHl && n.id !== undefined && hl.has(n.id);
        const dim = hasHl && !isHl ? 0.22 : 1;
        const pulse = isHl ? 1.35 + 0.35 * Math.sin(t * 3.4 + n.ph) : 1;
        // Zoom scales the drawn radii so nodes grow as you dive in. The diffuse
        // glow halos grow more gently (sqrt) than the crisp cores so they don't
        // blow out and wash the field white at high zoom.
        const rScale = vs;
        const glowScale = Math.sqrt(vs);
        if (n.bright) {
          const tw = 0.74 + 0.26 * Math.sin(t * 1.1 + n.ph);
          const R = n.r * 4.6 * tw * pulse * glowScale;
          ctx!.globalAlpha = 0.85 * tw * dim;
          ctx!.drawImage(SPR_STAR, x - R, y - R, R * 2, R * 2);
        } else {
          const tw = (0.55 + 0.45 * Math.sin(t * (n.sp || 1) + n.ph));
          const depth = 0.5 + 0.5 * n.z;
          ctx!.globalAlpha = Math.min(1, (n.a || 0.4) * tw * depth * 1.5) * dim;
          const spr = n.glow ? SPR_STAR : (n.g ? SPR_GLOW : SPR_DOT);
          const R = n.r * (n.glow ? 4 : 2.6) * pulse * glowScale;
          ctx!.drawImage(spr, x - R, y - R, R * 2, R * 2);
        }
        // recalled-star ring — the "graph responds to the conversation" moment
        if (isHl) {
          ctx!.globalAlpha = 0.6 + 0.4 * Math.sin(t * 3.4 + n.ph);
          ctx!.strokeStyle = 'rgba(140,255,180,0.9)'; ctx!.lineWidth = 1.2;
          ctx!.beginPath(); ctx!.arc(x, y, ((n.bright ? n.r * 2.2 : 6) + 5 * pulse) * rScale, 0, 6.2832); ctx!.stroke();
        }
        // At high zoom, label the brightest (most-liked) data nodes with a snippet
        // of their tweet so the constellation becomes readable up close.
        if (vs > 3.2 && n.bright && n.t && dim > 0.5) {
          const txt = n.t.replace(/\s+/g, ' ').trim().slice(0, 48);
          if (txt) {
            ctx!.globalCompositeOperation = 'source-over';
            ctx!.globalAlpha = Math.min(1, (vs - 3.2) / 1.6) * dim;
            ctx!.font = '11px ui-monospace,Menlo,monospace';
            ctx!.fillStyle = 'rgba(234,255,240,0.92)';
            ctx!.textAlign = 'center';
            const R = n.r * 4.6 * glowScale;
            ctx!.fillText(txt, x, y + R + 12);
            ctx!.textAlign = 'left';
            ctx!.globalCompositeOperation = 'lighter';
          }
        }
      }
      // ── live X posts: persistent faint field stars + a birth ignite (bloom + ring) ──
      for (const n of live) {
        const [ox, oy] = bucketOff(zBucket(n.z));
        const x = (n.x + ox) * vs + vox, y = (n.y + oy) * vs + voy;
        const age = (now - (n.born || now)) / 1000;
        const birth = age < 2.4 ? (1 - age / 2.4) : 0;  // birth ignite fades over ~2.4s
        const gS = Math.sqrt(vs);
        const tw = 0.55 + 0.45 * Math.sin(t * (n.sp || 1) + n.ph);
        // persistent faint dot — it has joined the field, hoverable like a memory star
        ctx!.globalAlpha = Math.min(1, 0.44 * tw * 1.5);
        { const R = n.r * 2.7 * gS; ctx!.drawImage(SPR_GLOW, x - R, y - R, R * 2, R * 2); }
        // birth flash: extra bloom + an expanding ring the moment it streams in
        if (birth > 0) {
          ctx!.globalAlpha = 0.9 * birth;
          const R = n.r * 5.2 * (0.6 + birth) * gS;
          ctx!.drawImage(SPR_STAR, x - R, y - R, R * 2, R * 2);
          ctx!.globalAlpha = birth * 0.7;
          ctx!.strokeStyle = 'rgba(150,255,190,0.9)'; ctx!.lineWidth = 1.3;
          ctx!.beginPath(); ctx!.arc(x, y, (n.r * 2 + (1 - birth) * 26) * vs, 0, 6.2832); ctx!.stroke();
        }
      }
      ctx!.globalAlpha = 1;
      if (hover) {
        const [ox, oy] = bucketOff(zBucket(hover.z));
        const hx = (hover.x + ox) * vs + vox, hy = (hover.y + oy) * vs + voy;
        ctx!.globalCompositeOperation = 'source-over';
        ctx!.strokeStyle = 'rgba(234,255,240,.92)'; ctx!.lineWidth = 1.4;
        ctx!.beginPath(); ctx!.arc(hx, hy, ((hover.bright ? hover.r * 2.2 : 5) + 3) * vs, 0, 6.2832); ctx!.stroke();
      }
      ctx!.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }

    let hover: StarNode | null = null;
    function pick(mx: number, my: number): StarNode | null {
      // Same view transform as the render loop: node world pos → screen pos, so
      // the hit-test stays aligned with what's drawn when zoomed/panned.
      const vw = viewRef.current, vs = vw.scale, vox = vw.ox, voy = vw.oy;
      let best: StarNode | null = null, bd = 1e9;
      for (const n of dataNodes) {
        const [ox, oy] = bucketOff(zBucket(n.z));
        const sx = (n.x + ox) * vs + vox, sy = (n.y + oy) * vs + voy;
        const d = (sx - mx) ** 2 + (sy - my) ** 2;
        // hit radius grows with zoom (nodes are bigger) but keeps a sane floor.
        const hit = (n.bright ? Math.max(16, n.r * 2.6) : 9) * Math.max(1, vs * 0.85);
        if (d < hit * hit && d < bd) { bd = d; best = n; }
      }
      return best;
    }
    function moveTip(mx: number, my: number, n: StarNode) {
      tip!.innerHTML = (n.t || '').replace(/</g, '&lt;') + '<span class="lk">♥ ' + (n.l || 0).toLocaleString() + '</span>';
      tip!.classList.add('on');
      let tx = mx + 16, ty = my + 14;
      if (tx > W - 350) tx = mx - 16 - (tip!.offsetWidth || 300);
      if (ty > H - 96) ty = my - 14 - (tip!.offsetHeight || 80);
      tip!.style.left = tx + 'px'; tip!.style.top = ty + 'px';
    }
    // ── zoom + pan interaction ───────────────────────────────────────────────
    const MIN_SCALE = 0.6, MAX_SCALE = 7;
    const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    // Keep the pan within a generous bound so the constellation can't be lost.
    function clampPan() {
      const v = viewRef.current;
      const margin = Math.max(W, H) * (v.scale - 0.5);
      v.ox = Math.max(-W * v.scale - margin, Math.min(W * v.scale + margin, v.ox));
      v.oy = Math.max(-H * v.scale - margin, Math.min(H * v.scale + margin, v.oy));
    }
    // Zoom toward a screen point (sx,sy): keep the world point under it fixed.
    function zoomAt(sx: number, sy: number, factor: number) {
      const v = viewRef.current;
      const next = clampScale(v.scale * factor);
      if (next === v.scale) return;
      const worldX = (sx - v.ox) / v.scale, worldY = (sy - v.oy) / v.scale;
      v.scale = next;
      v.ox = sx - worldX * next;
      v.oy = sy - worldY * next;
      clampPan();
    }
    function resetView() { viewRef.current = { scale: 1, ox: 0, oy: 0 }; }

    let dragging = false, dragX = 0, dragY = 0;

    const onMove = (e: MouseEvent) => {
      const rc = wrap!.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
      if (dragging) {
        const dx = mx - dragX, dy = my - dragY;
        const v = viewRef.current;
        v.ox += dx; v.oy += dy;
        dragX = mx; dragY = my;
        clampPan();
        if (hover) { hover = null; tip!.classList.remove('on'); }
        return;
      }
      txp = (mx / W - 0.5) * 2; typ = (my / H - 0.5) * 2;
      const n = pick(mx, my);
      if (n) { hover = n; moveTip(mx, my, n); } else if (hover) { hover = null; tip!.classList.remove('on'); }
    };
    const onLeave = () => { hover = null; tip!.classList.remove('on'); txp = 0; typ = 0; };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const rc = wrap!.getBoundingClientRect();
      dragging = true;
      dragX = e.clientX - rc.left; dragY = e.clientY - rc.top;
      hover = null; tip!.classList.remove('on');
      wrap!.style.cursor = 'grabbing';
    };
    const onUp = () => { dragging = false; wrap!.style.cursor = ''; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rc = wrap!.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
      // trackpad + wheel: exponential zoom for a smooth feel
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(mx, my, factor);
    };
    const onDblClick = (e: MouseEvent) => { e.preventDefault(); resetView(); hover = null; tip!.classList.remove('on'); };

    // ── touch: one-finger pan (+ tap-to-read), two-finger pinch-zoom ──
    let touchMode: 'none' | 'pan' | 'pinch' = 'none';
    let tPrevX = 0, tPrevY = 0, tPrevDist = 0;
    const touchDist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const onTouchStart = (e: TouchEvent) => {
      const rc = wrap!.getBoundingClientRect();
      if (e.touches.length === 1) {
        touchMode = 'pan';
        tPrevX = e.touches[0].clientX - rc.left; tPrevY = e.touches[0].clientY - rc.top;
        // provisional hover on tap
        const n = pick(tPrevX, tPrevY);
        if (n) { hover = n; moveTip(tPrevX, tPrevY, n); } else { hover = null; tip!.classList.remove('on'); }
      } else if (e.touches.length === 2) {
        touchMode = 'pinch';
        tPrevDist = touchDist(e.touches[0], e.touches[1]);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      const rc = wrap!.getBoundingClientRect();
      if (touchMode === 'pan' && e.touches.length === 1) {
        const mx = e.touches[0].clientX - rc.left, my = e.touches[0].clientY - rc.top;
        const dx = mx - tPrevX, dy = my - tPrevY;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          const v = viewRef.current; v.ox += dx; v.oy += dy; clampPan();
          hover = null; tip!.classList.remove('on');
        }
        tPrevX = mx; tPrevY = my;
      } else if (touchMode === 'pinch' && e.touches.length === 2) {
        const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rc.left;
        const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rc.top;
        const dist = touchDist(e.touches[0], e.touches[1]);
        if (tPrevDist > 0) zoomAt(mx, my, dist / tPrevDist);
        tPrevDist = dist;
      }
    };
    const onTouchEnd = () => { touchMode = 'none'; };

    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', onLeave);
    wrap.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    wrap.addEventListener('wheel', onWheel, { passive: false });
    wrap.addEventListener('dblclick', onDblClick);
    wrap.addEventListener('touchstart', onTouchStart, { passive: true });
    wrap.addEventListener('touchmove', onTouchMove, { passive: true });
    wrap.addEventListener('touchend', onTouchEnd, { passive: true });
    wrap.style.cursor = 'grab';

    let rt = 0;
    const onResize = () => { clearTimeout(rt); rt = window.setTimeout(resize, 140); };
    window.addEventListener('resize', onResize);

    resize();
    raf = requestAnimationFrame(frame);
    if (reduce) { wrap.style.transition = 'none'; wrap.classList.add('in'); }
    else { requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('in'))); }

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(rt);
      wrap.removeEventListener('mousemove', onMove);
      wrap.removeEventListener('mouseleave', onLeave);
      wrap.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      wrap.removeEventListener('wheel', onWheel);
      wrap.removeEventListener('dblclick', onDblClick);
      wrap.removeEventListener('touchstart', onTouchStart);
      wrap.removeEventListener('touchmove', onTouchMove);
      wrap.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('resize', onResize);
    };
    // Rebuild only when the node set changes (highlight is read via ref, no rebuild).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  return (
    <>
      <style>{`
        #ansem-wrap{position:absolute;inset:0;background:#000;overflow:hidden;font-family:ui-monospace,'SF Mono',Menlo,monospace;color:#bdf5d0;user-select:none;opacity:0;transition:opacity 1.4s ease}
        #ansem-wrap.in{opacity:1}
        #ansem-c{position:absolute;inset:0;width:100%;height:100%;display:block}
        #ansem-vig{position:absolute;inset:0;z-index:2;pointer-events:none;background:radial-gradient(120% 100% at 50% 46%, rgba(0,0,0,0) 46%, rgba(0,0,0,.34) 74%, rgba(0,0,0,.72) 100%)}
        #ansem-tip{position:absolute;z-index:5;max-width:min(330px,72vw);padding:11px 13px;border:1px solid rgba(72,224,122,.5);border-radius:10px;background:rgba(2,14,8,.95);backdrop-filter:blur(7px);color:#eafff0;font-size:13px;line-height:1.5;box-shadow:0 10px 44px rgba(0,0,0,.7),0 0 24px rgba(34,197,94,.22);opacity:0;transform:translateY(4px);transition:opacity .1s;pointer-events:none;white-space:pre-wrap}
        #ansem-tip.on{opacity:1;transform:translateY(0)}
        #ansem-tip .lk{display:block;margin-top:7px;font-size:11px;color:#3ddc73;letter-spacing:.04em;font-variant-numeric:tabular-nums}
      `}</style>
      <div id="ansem-wrap" ref={wrapRef}>
        <canvas id="ansem-c" ref={canvasRef} />
        <div id="ansem-vig" />
        <div id="ansem-tip" ref={tipRef} />
      </div>
    </>
  );
}

// ── "Speak to Ansem" chat ────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  memoryIds?: number[];
  streaming?: boolean;
}

function AnsemChat({
  onHighlight,
  onChainClick,
  chainEnabled,
}: {
  onHighlight: (ids: Set<number>) => void;
  onChainClick?: () => void;
  chainEnabled?: boolean;
}) {
  const STORAGE_KEY = 'ansem-chat-history';
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  // The whole panel collapses to a floating orb by default (open only if we already have history).
  const [open, setOpen] = useState(false);
  // Voice playback: muted toggle (default unmuted — but no audio plays until the
  // first user submit, which is the gesture that satisfies browser autoplay policy).
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  // Mobile keyboard handling: track the VISUAL viewport so the chat sheet shrinks to
  // sit above the on-screen keyboard instead of being hidden behind it.
  const [vv, setVv] = useState<{ h: number; top: number }>(() => ({
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
    top: 0,
  }));
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
  useEffect(() => {
    const vvp = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vvp) return;
    const onVv = () => setVv({ h: vvp.height, top: vvp.offsetTop });
    onVv();
    vvp.addEventListener('resize', onVv);
    vvp.addEventListener('scroll', onVv);
    return () => { vvp.removeEventListener('resize', onVv); vvp.removeEventListener('scroll', onVv); };
  }, []);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const contentRef = useRef('');
  const rafRef = useRef(0);
  const lastUpdateRef = useRef(0);

  // ── Avatar amplitude driving ────────────────────────────────────────────────
  // The bull avatar exposes setAmp(0..1). We drive it TWO ways:
  //   1) REAL voice — POST /api/ansem/speak → {audio_url}, played through a Web
  //      Audio AnalyserNode; each frame we read the RMS level of the actual
  //      Sterling audio and feed it into setAmp, so the mouth/eyes/head move to
  //      the real speech. On audio end → setAmp(0).
  //   2) FALLBACK synthetic flutter — if /api/ansem/speak is unavailable (e.g.
  //      501 voice_not_configured) or errors, we keep a lively speech-like
  //      flutter running for the duration of the stream so the bull still
  //      "talks" without audio.
  const avatarRef = useRef<AvatarBullHandle>(null);
  const talkRafRef = useRef(0);          // synthetic-flutter rAF (fallback + during stream)
  const audioRafRef = useRef(0);         // real-audio analyser rAF
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioSrcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const speakingRef = useRef(false);     // true while real audio is driving the avatar

  const API_BASE = import.meta.env.VITE_API_BASE || '';

  // Create/resume the AudioContext. MUST be called from a user gesture (the first
  // chat submit) to satisfy browser autoplay policy.
  const ensureAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const el = new Audio();
      el.crossOrigin = 'anonymous';   // needed for AnalyserNode to read cross-origin audio
      const src = ctx.createMediaElementSource(el);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      audioElRef.current = el;
      audioSrcRef.current = src;
      analyserRef.current = analyser;
    }
    if (audioCtxRef.current.state === 'suspended') { void audioCtxRef.current.resume(); }
    return audioCtxRef.current;
  }, []);

  // Synthetic speech-like flutter — the fallback + the during-stream animation.
  const startTalking = useCallback(() => {
    if (talkRafRef.current || speakingRef.current) return;   // already talking (synthetic or real)
    const t0 = performance.now();
    const tick = (now: number) => {
      if (speakingRef.current) { talkRafRef.current = 0; return; }   // real audio took over
      const t = (now - t0) / 1000;
      // layered sines → an organic mouth flutter, biased lively (~0.35..0.95)
      const flutter =
        0.5 + 0.32 * Math.abs(Math.sin(t * 11.0)) * Math.abs(Math.sin(t * 6.3 + 0.7))
        + 0.14 * Math.sin(t * 3.1);
      avatarRef.current?.setAmp(Math.max(0.2, Math.min(1, flutter)));
      talkRafRef.current = requestAnimationFrame(tick);
    };
    talkRafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopTalking = useCallback(() => {
    if (talkRafRef.current) { cancelAnimationFrame(talkRafRef.current); talkRafRef.current = 0; }
    if (!speakingRef.current) {
      // ramp back toward idle-quiet; the avatar's own idle-sim resumes from here
      avatarRef.current?.setAmp(0.05);
    }
  }, []);

  // Real voice: fetch TTS for `text`, play it, and drive setAmp from the live RMS
  // level. Returns true if audio actually started (so the caller can drop the
  // synthetic flutter); false → caller keeps the synthetic animation.
  const speak = useCallback(async (text: string): Promise<boolean> => {
    if (mutedRef.current || !text.trim()) return false;
    const ctx = ensureAudio();
    const el = audioElRef.current, analyser = analyserRef.current;
    if (!ctx || !el || !analyser) return false;

    let audioUrl = '';
    let isBlobUrl = false;
    try {
      const res = await fetch(`${API_BASE}/api/ansem/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      // 501 voice_not_configured (or any non-OK) → graceful fallback to synthetic
      if (!res.ok) return false;
      const ctype = res.headers.get('content-type') || '';
      if (ctype.includes('audio')) {
        // ElevenLabs (primary): raw mp3 bytes → play via an object URL (near-instant)
        audioUrl = URL.createObjectURL(await res.blob());
        isBlobUrl = true;
      } else {
        // Higgsfield (fallback): { audio_url } CDN link
        const data = (await res.json()) as { audio_url?: string };
        audioUrl = data.audio_url || '';
      }
      if (!audioUrl) return false;
    } catch {
      return false;   // network/parse error → fallback
    }

    // Real audio is available — take over from the synthetic flutter.
    if (talkRafRef.current) { cancelAnimationFrame(talkRafRef.current); talkRafRef.current = 0; }
    speakingRef.current = true;

    return await new Promise<boolean>((resolve) => {
      const buf = new Uint8Array(analyser.fftSize);
      const drive = () => {
        analyser.getByteTimeDomainData(buf);
        // RMS of the centered waveform → 0..1 level
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        // scale up (speech RMS is small) + clamp; gentle floor so the mouth stays lively
        const level = Math.max(0, Math.min(1, rms * 2.6));
        avatarRef.current?.setAmp(level);
        audioRafRef.current = requestAnimationFrame(drive);
      };
      const cleanup = () => {
        if (audioRafRef.current) { cancelAnimationFrame(audioRafRef.current); audioRafRef.current = 0; }
        speakingRef.current = false;
        avatarRef.current?.setAmp(0);   // audio end → mouth closes
        if (isBlobUrl && audioUrl) URL.revokeObjectURL(audioUrl);   // free the blob
      };
      el.onended = () => { cleanup(); resolve(true); };
      el.onerror = () => { cleanup(); resolve(false); };
      el.src = audioUrl;
      audioRafRef.current = requestAnimationFrame(drive);
      el.play().catch(() => { cleanup(); resolve(false); });
    });
  }, [API_BASE, ensureAudio]);

  // clean up any loops if the component unmounts mid-stream
  useEffect(() => () => {
    if (talkRafRef.current) cancelAnimationFrame(talkRafRef.current);
    if (audioRafRef.current) cancelAnimationFrame(audioRafRef.current);
    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current.src = ''; }
    if (audioCtxRef.current) { void audioCtxRef.current.close(); }
  }, []);

  // Persist non-streaming messages to localStorage
  useEffect(() => {
    const settled = messages.filter((m) => !m.streaming);
    if (settled.length > 0) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settled)); } catch { /* full */ }
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [messages]);

  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); };
  useEffect(scrollToBottom, [messages, open]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || streaming) return;

    // This submit is a user gesture → create/resume the AudioContext now, so the
    // TTS audio is allowed to play later (browser autoplay policy).
    ensureAudio();

    const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: input.trim() };
    const assistantId = `assistant-${Date.now()}`;
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);
    contentRef.current = '';
    const abort = new AbortController();
    abortRef.current = abort;

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      await ansemApi.exploreChat(
        userMsg.content,
        history,
        (chunk) => {
          // first chunk → the clone is "speaking": animate the avatar
          startTalking();
          contentRef.current += chunk;
          const now = performance.now();
          if (now - lastUpdateRef.current < 66) return;
          lastUpdateRef.current = now;

          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => {
            const display = contentRef.current.replace(/\n?MEMORY_IDS:\s*\[[^\]]*\]?\s*$/, '');
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: display } : m)));
          });
        },
        (ids) => { onHighlight(new Set(ids)); },   // recalled_ids — light nodes in the BACKGROUND constellation as they come in
        (data) => {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          const cleanContent = data.clean_content || contentRef.current.replace(/\n?MEMORY_IDS:\s*\[[^\]]*\]\s*$/, '').trim();
          // memory_ids → pulse/highlight those nodes in the hero constellation
          if (data.memory_ids && data.memory_ids.length > 0) onHighlight(new Set(data.memory_ids));
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: cleanContent, memoryIds: data.memory_ids, streaming: false } : m,
            ),
          );
          // reply text complete → speak it with the REAL Sterling voice, driving
          // the bull from the live audio RMS. If /api/ansem/speak is unavailable
          // (501 / error), speak() returns false and the synthetic flutter that's
          // been running through the stream keeps the bull "talking"; either way
          // stopTalking() lands the mouth back to idle when playback finishes.
          void speak(cleanContent).finally(() => { stopTalking(); });
        },
        abort.signal,
      );
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e.name !== 'AbortError') {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: contentRef.current || `Error: ${e.message}`, streaming: false } : m,
          ),
        );
      }
      stopTalking();   // error/abort → land the avatar back to idle
                       // (the success path stops in onDone, after speak() resolves)
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, streaming, messages, onHighlight, startTalking, stopTalking, speak, ensureAudio]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleClear = () => {
    setMessages([]);
    onHighlight(new Set());
    contentRef.current = '';
  };

  const stopAudio = useCallback(() => {
    if (audioRafRef.current) { cancelAnimationFrame(audioRafRef.current); audioRafRef.current = 0; }
    speakingRef.current = false;
    const el = audioElRef.current;
    if (el) { el.pause(); el.onended = null; el.onerror = null; }
    avatarRef.current?.setAmp(0);
  }, []);

  const handleCollapse = () => {
    abortRef.current?.abort();
    stopAudio();
    stopTalking();
    onHighlight(new Set());   // clear the constellation highlight when the panel closes
    setOpen(false);
  };

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      if (next) stopAudio();   // muting mid-playback stops the current voice
      return next;
    });
  };

  return (
    <>
      <style>{`
        @keyframes ansemDotPulse { 0%, 60%, 100% { opacity: 0.2; transform: scale(1); } 30% { opacity: 1; transform: scale(1.3); } }
        @keyframes ansemOrbPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(60,224,120,.45), 0 8px 34px rgba(0,0,0,.55); } 50% { box-shadow: 0 0 0 10px rgba(60,224,120,0), 0 8px 34px rgba(0,0,0,.55); } }
        @keyframes ansemPanelIn { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
        #ansem-msgs::-webkit-scrollbar{width:6px}
        #ansem-msgs::-webkit-scrollbar-thumb{background:rgba(72,224,122,.25);border-radius:3px}
        .ansem-orb{transition:transform .18s ease, filter .18s ease}
        .ansem-orb:hover{transform:scale(1.06);filter:brightness(1.12)}
      `}</style>

      {/* ── Collapsed: on-chain pill + "Speak to Ansem" orb, one bottom-right row ── */}
      {!open && (
        <div style={{
          position: 'fixed', right: 'clamp(14px,3vw,28px)', bottom: 'clamp(14px,3vh,28px)', zIndex: 40,
          display: 'flex', alignItems: 'center', gap: 'clamp(7px,1.8vw,10px)',
        }}>
          {chainEnabled && onChainClick && (
            <button
              className="ansem-orb"
              onClick={onChainClick}
              aria-label="On-chain live-stream log"
              style={{
                display: 'flex', alignItems: 'center', gap: 5, borderRadius: 999, cursor: 'pointer',
                padding: 'clamp(6px,1.7vw,10px) clamp(9px,2.4vw,13px)',
                background: 'linear-gradient(180deg, rgba(6,26,16,.94), rgba(2,14,8,.94))',
                border: '1px solid rgba(72,224,122,.4)', backdropFilter: 'blur(8px)',
                boxShadow: '0 6px 22px rgba(0,0,0,.45)',
                fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#5cf08a', boxShadow: '0 0 7px #3ddc73', animation: 'ansemHudPulse 2s ease-in-out infinite', flexShrink: 0 }} />
              <span style={{ fontSize: 'clamp(8.5px,2.2vw,10.5px)', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#bfead0', whiteSpace: 'nowrap' }}>⛓ on-chain</span>
            </button>
          )}
          <button
            className="ansem-orb"
            onClick={() => setOpen(true)}
            aria-label="Speak to Ansem"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, borderRadius: 999, cursor: 'pointer',
              padding: 'clamp(7px,1.9vw,12px) clamp(12px,3vw,18px) clamp(7px,1.9vw,12px) clamp(10px,2.6vw,15px)',
              background: 'linear-gradient(180deg, rgba(6,26,16,.96), rgba(2,14,8,.96))',
              border: '1px solid rgba(72,224,122,.5)', backdropFilter: 'blur(8px)',
              animation: 'ansemOrbPulse 2.6s ease-in-out infinite',
              fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: '#5cf08a', boxShadow: '0 0 12px #3ddc73' }} />
            <span style={{ fontSize: 'clamp(9.5px,2.4vw,12px)', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#eafff0', whiteSpace: 'nowrap' }}>Speak to Ansem</span>
          </button>
        </div>
      )}

      {/* ── Expanded: floating conversation window (mobile = full sheet sized to the
             visual viewport so the keyboard never covers the input) ────────────── */}
      {open && (
        <div style={{
          position: 'fixed', zIndex: 40,
          ...(isMobile
            ? { left: 0, top: vv.top, width: '100vw', height: vv.h, borderRadius: 0, border: 'none', borderLeft: 'none' }
            : {
                right: 'clamp(12px,3vw,28px)', bottom: 'clamp(12px,3vh,28px)',
                width: 'min(380px, calc(100vw - 24px))', height: 'min(560px, calc(100dvh - 24px))',
                borderRadius: 18, border: '1px solid rgba(72,224,122,.34)',
              }),
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'rgba(2,12,7,.94)', backdropFilter: 'blur(12px)',
          boxShadow: '0 20px 70px rgba(0,0,0,.72), 0 0 34px rgba(34,197,94,.12)',
          animation: 'ansemPanelIn .28s cubic-bezier(.2,.8,.2,1)',
          fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
        }}>
          {/* (a) the neural-wave bull avatar — shrinks on mobile / when the keyboard is up */}
          <div style={{ position: 'relative', height: isMobile ? (vv.h < 620 ? 132 : 190) : 240, flexShrink: 0, background: '#000', borderBottom: '1px solid rgba(72,224,122,.18)' }}>
            <AvatarBull ref={avatarRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
            {/* header overlaid on the avatar: title + collapse */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'flex-start',
              justifyContent: 'space-between', padding: '11px 12px', pointerEvents: 'none',
            }}>
              <div style={{ textShadow: '0 0 16px #000' }}>
                <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.14em', color: '#eafff0' }}>$ANSEM</div>
                <div style={{ fontSize: 9, letterSpacing: '.16em', textTransform: 'uppercase', color: '#3ddc73', marginTop: 3 }}>
                  {streaming ? 'speaking' : 'listening'}
                </div>
                {/* tiny affordance: this is a synthetic, AI-generated voice */}
                <div style={{ fontSize: 8.5, letterSpacing: '.1em', color: 'rgba(147,232,178,.55)', marginTop: 4 }}>
                  {muted ? '🔇 voice muted' : '🔊 AI-generated voice'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={toggleMute}
                  aria-label={muted ? 'Unmute voice' : 'Mute voice'}
                  title={muted ? 'Unmute the AI voice' : 'Mute the AI voice'}
                  style={{
                    pointerEvents: 'auto', width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(2,14,8,.7)', border: '1px solid rgba(72,224,122,.3)',
                    color: '#9be8b2', fontSize: 13, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  {muted ? '🔇' : '🔊'}
                </button>
                <button
                  onClick={handleCollapse}
                  aria-label="Collapse"
                  style={{
                    pointerEvents: 'auto', width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(2,14,8,.7)', border: '1px solid rgba(72,224,122,.3)',
                    color: '#9be8b2', fontSize: 14, lineHeight: 1, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          </div>

          {/* (b) the streaming chat transcript */}
          <div id="ansem-msgs" style={{
            flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 12px 6px',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            {messages.length === 0 && (
              <div style={{ margin: 'auto 0', textAlign: 'center', color: 'rgba(147,232,178,.55)', fontSize: 12, lineHeight: 1.6, padding: '0 14px' }}>
                Ask $ANSEM anything.<br />
                <span style={{ fontSize: 10.5, color: 'rgba(147,232,178,.4)' }}>His answers light up the constellation behind me.</span>
              </div>
            )}
            {messages.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
                <button
                  onClick={handleClear}
                  style={{ background: 'none', border: 'none', color: 'rgba(92,240,138,.55)', fontSize: 9, cursor: 'pointer', letterSpacing: 0.5, fontFamily: 'inherit' }}
                >
                  Clear
                </button>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '90%' }}>
                <div style={{
                  padding: '7px 11px',
                  borderRadius: msg.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
                  background: msg.role === 'user' ? 'rgba(60,224,120,.14)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${msg.role === 'user' ? 'rgba(72,224,122,.32)' : 'rgba(255,255,255,.08)'}`,
                  fontSize: 12, lineHeight: 1.55, color: '#eafff0', whiteSpace: 'pre-wrap',
                }}>
                  {msg.content}
                  {msg.streaming && !msg.content && (
                    <span style={{ color: 'rgba(147,232,178,.7)', letterSpacing: 2, fontSize: 14 }}>
                      <span style={{ animation: 'ansemDotPulse 1.4s infinite', animationDelay: '0s' }}>.</span>
                      <span style={{ animation: 'ansemDotPulse 1.4s infinite', animationDelay: '0.2s' }}>.</span>
                      <span style={{ animation: 'ansemDotPulse 1.4s infinite', animationDelay: '0.4s' }}>.</span>
                    </span>
                  )}
                  {msg.streaming && msg.content && <span style={{ opacity: 0.35 }}>|</span>}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* (c) the input */}
          <div style={{
            flexShrink: 0, display: 'flex', gap: 0, margin: '0 10px 10px',
            background: 'rgba(2,14,8,.92)', borderRadius: 12, border: '1px solid rgba(72,224,122,.32)',
            overflow: 'hidden',
          }}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Speak to Ansem…"
              disabled={streaming}
              autoFocus
              style={{
                flex: 1, padding: '12px 15px', fontSize: 13,
                fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
                background: 'transparent', border: 'none', color: '#eafff0', outline: 'none', minWidth: 0,
              }}
            />
            <button
              onClick={streaming ? () => { abortRef.current?.abort(); stopAudio(); } : handleSend}
              disabled={!streaming && !input.trim()}
              style={{
                padding: '12px 16px', fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase',
                fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
                background: 'transparent',
                color: streaming ? '#f87171' : !input.trim() ? 'rgba(92,240,138,.4)' : '#5cf08a',
                border: 'none', borderLeft: '1px solid rgba(72,224,122,.22)',
                cursor: !streaming && !input.trim() ? 'default' : 'pointer', flexShrink: 0,
              }}
            >
              {streaming ? 'Stop' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function AnsemExplore() {
  useEffect(() => {
    document.documentElement.classList.add('dark');
    const prevBg = document.body.style.background;
    document.body.style.background = '#000';
    return () => {
      document.documentElement.classList.remove('dark');
      document.body.style.background = prevBg;
    };
  }, []);

  const { nodes, total, loading, error } = useAnsemData();
  const [highlightIds, setHighlightIds] = useState<Set<number>>(new Set());
  const [bullTip, setBullTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const [nodePopup, setNodePopup] = useState<BullNode | null>(null);
  // derived context/relation for the open node (its source X post + what it replied to)
  const [nodeCtx, setNodeCtx] = useState<{ loading: boolean; context: string; parent: { handle: string; name: string; text: string } | null; url: string | null; replyHandle: string | null; hash?: string; sig?: string } | null>(null);
  useEffect(() => {
    if (!nodePopup) { setNodeCtx(null); return; }
    let stop = false;
    setNodeCtx({ loading: true, context: '', parent: null, url: nodePopup.url || null, replyHandle: null });
    ansemApi.getNodeContext({
      id: nodePopup.id > 0 ? nodePopup.id : undefined,   // live nodes have synthetic negative ids
      text: nodePopup.content || '',
      live: !!nodePopup.live,
      url: nodePopup.url,
    })
      .then((d) => { if (!stop) setNodeCtx({ loading: false, context: d.context, parent: d.parent, url: d.url, replyHandle: d.replyHandle, hash: d.hash, sig: d.sig }); })
      .catch(() => { if (!stop) setNodeCtx((c) => (c ? { ...c, loading: false } : null)); });
    return () => { stop = true; };
  }, [nodePopup]);
  // live-stream affordances: joined-count + transient toasts + the on-chain log modal
  const [liveJoined, setLiveJoined] = useState(0);
  const [toasts, setToasts] = useState<Array<{ id: number; text: string }>>([]);
  const toastSeq = useRef(0);
  const [chainOpen, setChainOpen] = useState(false);
  const [chain, setChain] = useState<Awaited<ReturnType<typeof ansemApi.getAttestations>> | null>(null);
  useEffect(() => {
    if (!chainOpen) return;
    let stop = false;
    ansemApi.getAttestations().then((d) => { if (!stop) setChain(d); }).catch(() => { if (!stop) setChain(null); });
    return () => { stop = true; };
  }, [chainOpen]);
  // lightweight live count for the standalone on-chain badge (independent of the modal)
  const [chainStat, setChainStat] = useState<{ enabled: boolean; hashes: number; txs: number } | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () => ansemApi.getAttestations()
      .then((d) => { if (!stop) setChainStat({ enabled: d.enabled, hashes: d.attestations.reduce((s, a) => s + a.hashes.length, 0), txs: d.attestations.length }); })
      .catch(() => {});
    load();
    const iv = window.setInterval(load, 60000);
    return () => { stop = true; window.clearInterval(iv); };
  }, []);
  useEffect(() => { document.title = '$ANSEM — The Black Bull Community Clone'; }, []);
  const handleLiveJoin = useCallback((posts: BullNode[]) => {
    setLiveJoined((c) => c + posts.length);
    posts.slice(0, 3).forEach((p, i) => {
      const id = ++toastSeq.current;
      window.setTimeout(() => {
        setToasts((ts) => [...ts, { id, text: `@${p.handle || 'anon'} joined the constellation` }]);
        window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4600);
      }, i * 900);
    });
  }, []);
  const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const onR = () => setIsNarrow(window.innerWidth < 640);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setHighlightIds(new Set()); setNodePopup(null); } };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const countLabel = useMemo(() => (total || 38303).toLocaleString(), [total]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace" }}>
      {!loading && !error && (
        <BullSwarm3D
          nodes={nodes}
          highlightIds={highlightIds}
          onHover={(n, x, y) => setBullTip(n && n.content ? { text: n.content, x, y } : null)}
          onSelect={(n) => { setBullTip(null); setNodePopup(n); }}
          onLiveJoin={handleLiveJoin}
        />
      )}

      {/* ── Fly-in toasts: a new post just joined the constellation ──────────── */}
      {toasts.length > 0 && (
        <div style={{ position: 'fixed', bottom: 96, left: '50%', transform: 'translateX(-50%)', zIndex: 45, display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center', pointerEvents: 'none' }}>
          <style>{`@keyframes ansemToastIn { from { opacity:0; transform:translateY(12px) scale(.92); } to { opacity:1; transform:translateY(0) scale(1); } }`}</style>
          {toasts.map((t) => (
            <div key={t.id} style={{
              padding: '8px 16px', borderRadius: 999, whiteSpace: 'nowrap',
              background: 'rgba(3,18,10,.9)', border: '1px solid rgba(92,240,138,.4)', backdropFilter: 'blur(8px)',
              color: '#c9f5d8', fontSize: 11.5, letterSpacing: '.05em',
              fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
              boxShadow: '0 8px 30px rgba(0,0,0,.5), 0 0 18px rgba(60,224,120,.15)',
              animation: 'ansemToastIn .45s cubic-bezier(.2,.9,.3,1.2)',
            }}>
              ✦ {t.text}
            </div>
          ))}
        </div>
      )}

      {/* ── On-chain live-stream log — sha256 hashes committed via Solana memo ── */}
      {chainOpen && (
        <div
          onClick={() => setChainOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 70,
            background: 'rgba(0,0,0,.62)', backdropFilter: 'blur(7px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 100%)', maxHeight: '76vh', overflowY: 'auto',
              borderRadius: 18, padding: '18px 20px 16px',
              border: '1px solid rgba(72,224,122,.42)',
              background: 'linear-gradient(180deg, rgba(4,22,13,.97), rgba(2,12,7,.97))',
              boxShadow: '0 30px 90px rgba(0,0,0,.75), 0 0 44px rgba(34,197,94,.14)',
              fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
              animation: 'ansemPopIn .26s cubic-bezier(.2,.9,.3,1.15)',
            }}
          >
            <style>{`@keyframes ansemPopIn { from { opacity:0; transform:scale(.88) translateY(14px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.12em', color: '#eafff0' }}>⛓ ON-CHAIN LIVE-STREAM LOG</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setChainOpen(false)} aria-label="Close" style={{ width: 26, height: 26, borderRadius: 8, cursor: 'pointer', background: 'rgba(60,224,120,.08)', border: '1px solid rgba(72,224,122,.3)', color: '#93e8b2', fontSize: 13, fontFamily: 'inherit' }}>✕</button>
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.6, color: '#5aa877', marginBottom: 14 }}>
              every post streamed into the constellation is hashed (sha-256 of id:text) and the hashes are committed to
              Solana as memo transactions{chain?.wallet ? <> from <span style={{ color: '#93e8b2' }}>{chain.wallet.slice(0, 4)}…{chain.wallet.slice(-4)}</span></> : null} — a public, verifiable record of what the bull has seen.
            </div>
            {!chain && <div style={{ fontSize: 11.5, color: 'rgba(147,232,178,.5)', padding: '10px 0' }}>loading…</div>}
            {chain && !chain.enabled && (
              <div style={{ fontSize: 11.5, color: 'rgba(147,232,178,.55)', padding: '10px 0' }}>
                on-chain attestation is warming up — hashes will start committing as new posts stream in.
              </div>
            )}
            {chain && chain.enabled && chain.attestations.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'rgba(147,232,178,.55)', padding: '10px 0' }}>
                no commits yet this session — the next new posts to stream in will be hashed + committed.
                {chain.pending > 0 ? ` (${chain.pending} pending)` : ''}
              </div>
            )}
            {chain && chain.attestations.map((a) => (
              <div key={a.sig} style={{ borderTop: '1px solid rgba(72,224,122,.14)', padding: '10px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                  <span style={{ color: 'rgba(147,232,178,.5)', fontVariantNumeric: 'tabular-nums' }}>{new Date(a.ts).toLocaleTimeString()}</span>
                  <span style={{ color: '#5aa877' }}>{a.hashes.length} hash{a.hashes.length !== 1 ? 'es' : ''}</span>
                  <span style={{ flex: 1 }} />
                  <a href={`https://solscan.io/tx/${a.sig}`} target="_blank" rel="noopener noreferrer" style={{ color: '#5cf08a', textDecoration: 'none', letterSpacing: '.04em' }}>
                    {a.sig.slice(0, 8)}…{a.sig.slice(-6)} ↗
                  </a>
                </div>
                {a.hashes.map((h) => (
                  <div key={h.hash} style={{ display: 'flex', gap: 10, marginTop: 5, fontSize: 10.5, color: 'rgba(147,232,178,.65)' }}>
                    <span style={{ color: '#7fd8a0', flexShrink: 0 }}>@{h.handle}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{h.hash}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ marginTop: 12, fontSize: 9.5, color: 'rgba(147,232,178,.4)', letterSpacing: '.05em' }}>
              log lists this server session · the chain record itself is permanent
            </div>
          </div>
        </div>
      )}

      {/* ── Node detail popup — click/tap a star ─────────────────────────────── */}
      {nodePopup && (
        <div
          onClick={() => setNodePopup(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 70,
            background: 'rgba(0,0,0,.62)', backdropFilter: 'blur(7px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <style>{`
            @keyframes ansemPopIn { from { opacity:0; transform:scale(.88) translateY(14px); } to { opacity:1; transform:scale(1) translateY(0); } }
            @keyframes ansemLivePulse { 0%,100% { opacity:1; box-shadow:0 0 0 0 rgba(92,240,138,.5); } 50% { opacity:.65; box-shadow:0 0 0 6px rgba(92,240,138,0); } }
          `}</style>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(460px, 100%)', maxHeight: '72vh', overflowY: 'auto',
              borderRadius: 18, padding: '18px 20px 16px',
              border: '1px solid rgba(72,224,122,.42)',
              background: 'linear-gradient(180deg, rgba(4,22,13,.97), rgba(2,12,7,.97))',
              boxShadow: '0 30px 90px rgba(0,0,0,.75), 0 0 44px rgba(34,197,94,.14)',
              fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
              animation: 'ansemPopIn .26s cubic-bezier(.2,.9,.3,1.15)',
            }}
          >
            {/* header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{
                width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                background: nodePopup.live ? '#5cf08a' : '#3ddc73',
                boxShadow: nodePopup.live ? '0 0 12px #5cf08a' : 'none',
                animation: nodePopup.live ? 'ansemLivePulse 2s ease-in-out infinite' : undefined,
              }} />
              <span style={{ flex: 1, fontSize: 10.5, letterSpacing: '.18em', textTransform: 'uppercase', color: '#7fd8a0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nodePopup.live
                  ? <>{nodePopup.name || 'live post'} <span style={{ color: 'rgba(147,232,178,.55)' }}>@{nodePopup.handle}</span> · <span style={{ color: '#5cf08a' }}>LIVE</span></>
                  : <>memory node <span style={{ color: 'rgba(147,232,178,.45)' }}>· {(nodePopup.createdAt || '').slice(0, 10) || 'the $ANSEM archive'}</span></>}
              </span>
              <button
                onClick={() => setNodePopup(null)}
                aria-label="Close"
                style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: 8, cursor: 'pointer',
                  background: 'rgba(60,224,120,.08)', border: '1px solid rgba(72,224,122,.3)',
                  color: '#93e8b2', fontSize: 13, lineHeight: 1, fontFamily: 'inherit',
                }}
              >✕</button>
            </div>
            {/* replying-to line (shows immediately from the leading @mention) */}
            {(() => {
              const rh = nodeCtx?.replyHandle || (nodePopup.content?.match(/^@(\w+)/)?.[1] ?? null);
              return rh ? (
                <div style={{ fontSize: 11, color: '#7fd8a0', marginBottom: 8, letterSpacing: '.02em' }}>
                  ↩ replying to <span style={{ color: '#5cf08a' }}>@{rh}</span>
                </div>
              ) : null;
            })()}
            {/* tweet text */}
            <div style={{ fontSize: 14.5, lineHeight: 1.65, color: '#eafff0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {nodePopup.content}
            </div>
            {/* derived context & relation */}
            <div style={{ marginTop: 14, padding: '11px 13px', borderRadius: 12, background: 'rgba(60,224,120,.06)', border: '1px solid rgba(72,224,122,.18)' }}>
              <div style={{ fontSize: 9.5, letterSpacing: '.18em', textTransform: 'uppercase', color: '#5aa877', marginBottom: 7 }}>
                ✦ context &amp; relation
              </div>
              {(!nodeCtx || nodeCtx.loading) ? (
                <div style={{ fontSize: 12, color: 'rgba(147,232,178,.5)', animation: 'ansemHudPulse 1.4s ease-in-out infinite' }}>
                  drawing context…
                </div>
              ) : (nodeCtx.context || nodeCtx.parent) ? (
                <>
                  {nodeCtx.context && <div style={{ fontSize: 12.5, lineHeight: 1.55, color: '#cdeed8' }}>{nodeCtx.context}</div>}
                  {nodeCtx.parent && (
                    <div style={{ marginTop: nodeCtx.context ? 9 : 0, paddingLeft: 9, borderLeft: '2px solid rgba(72,224,122,.3)', fontSize: 11, lineHeight: 1.5, color: 'rgba(147,232,178,.75)' }}>
                      <span style={{ color: '#7fd8a0' }}>↳ @{nodeCtx.parent.handle}</span>{nodeCtx.parent.name ? ` (${nodeCtx.parent.name})` : ''}: “{nodeCtx.parent.text.slice(0, 200)}{nodeCtx.parent.text.length > 200 ? '…' : ''}”
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12, color: 'rgba(147,232,178,.45)' }}>context couldn’t be resolved for this post.</div>
              )}
            </div>
            {/* footer */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 14px', marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(72,224,122,.16)', fontSize: 11.5, color: '#7fd8a0' }}>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>♥ {(nodePopup.likes || 0).toLocaleString()}</span>
              {!nodePopup.live && nodePopup.type && <span style={{ color: 'rgba(147,232,178,.5)', textTransform: 'uppercase', letterSpacing: '.1em', fontSize: 9.5 }}>{nodePopup.type}</span>}
              <span style={{ flex: 1, minWidth: 8 }} />
              {nodeCtx?.sig && (
                <a href={`https://solscan.io/tx/${nodeCtx.sig}`} target="_blank" rel="noopener noreferrer"
                  title={nodeCtx.hash ? `sha256 ${nodeCtx.hash.slice(0, 16)}… committed on Solana` : 'committed on Solana'}
                  style={{ color: '#9be8b2', textDecoration: 'none', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>
                  ⛓ view on Solscan ↗
                </a>
              )}
              {(nodeCtx?.url || nodePopup.url) && (
                <a href={nodeCtx?.url || nodePopup.url} target="_blank" rel="noopener noreferrer" style={{ color: '#5cf08a', textDecoration: 'none', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>
                  view on X ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}
      {bullTip && (
        <div style={{
          position: 'fixed',
          left: Math.max(8, Math.min(bullTip.x + 16, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 316)),
          top: bullTip.y + 14, zIndex: 50, maxWidth: 'min(300px, calc(100vw - 24px))', padding: '9px 12px', borderRadius: 10,
          background: 'rgba(2,12,7,.92)', border: '1px solid rgba(72,224,122,.35)', backdropFilter: 'blur(8px)',
          fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: 12, lineHeight: 1.5, color: '#dff5e6',
          pointerEvents: 'none', boxShadow: '0 10px 30px rgba(0,0,0,.6)',
        }}>
          {bullTip.text.slice(0, 240)}
        </div>
      )}

      {/* HUD — title, subtitle, count, disclaimer */}
      <div id="ansem-hud" style={{
        position: 'absolute', left: 'clamp(16px,3vw,34px)', top: 'clamp(14px,3vh,26px)',
        pointerEvents: 'none', zIndex: 3, textShadow: '0 0 20px rgba(0,0,0,.95)',
      }}>
        <div style={{ fontWeight: 800, fontSize: 'clamp(28px,4.6vw,44px)', letterSpacing: '.16em', color: '#eafff0', lineHeight: 1 }}>
          $ANSEM
        </div>
        <div style={{ fontSize: 'clamp(10px,1.3vw,12.5px)', letterSpacing: '.2em', color: '#3ddc73', marginTop: 7, textTransform: 'uppercase' }}>
          the black bull community clone
        </div>
        <div style={{ fontSize: 'clamp(9.5px,1.1vw,11px)', letterSpacing: '.22em', color: '#7fd8a0', marginTop: 5, textTransform: 'uppercase' }}>
          the movement · made tangible
        </div>
        <div style={{ fontSize: 'clamp(10.5px,1.2vw,12px)', color: '#7fd8a0', marginTop: 13, letterSpacing: '.02em' }}>
          <span style={{ color: '#5cf08a', fontVariantNumeric: 'tabular-nums' }}>{countLabel}</span> memories, one mind
        </div>
        <div style={{ fontSize: 'clamp(10px,1.15vw,12px)', color: '#8fd9ab', marginTop: 9, lineHeight: 1.5, letterSpacing: '.01em', maxWidth: 360 }}>
          his posts, the believers, the live timeline — the $ANSEM movement distilled into one living entity you can speak to.
        </div>
        <div style={{ fontSize: 'clamp(9.5px,1.05vw,11px)', color: '#5aa877', marginTop: 8, letterSpacing: '.02em', maxWidth: 360 }}>
          community-built AI clone · not the real Ansem · <span style={{ color: '#3c6b52' }}>not financial advice</span>
        </div>
        {/* live-stream status — how content flows in + the on-chain proof */}
        <style>{`@keyframes ansemHudPulse { 0%,100% { opacity:1; } 50% { opacity:.45; } }`}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#5cf08a', boxShadow: '0 0 8px #3ddc73', animation: 'ansemHudPulse 2s ease-in-out infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 'clamp(9.5px,1vw,11px)', letterSpacing: '.06em', color: '#5aa877' }}>
            streaming the $ANSEM timeline live{liveJoined > 0 ? ` · ${liveJoined} joined` : ''}
          </span>
        </div>
      </div>

      {/* Powered-by-Clude logo — top-right, links to the main site */}
      <a
        href="https://clude.io"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Powered by Clude — clude.io"
        style={{
          position: 'fixed', top: 'clamp(14px,2.6vh,20px)', right: 'clamp(12px,3vw,24px)', zIndex: 6,
          display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none',
          padding: '6px 11px 6px 10px', borderRadius: 999,
          border: '1px solid rgba(255,255,255,.12)', background: 'rgba(0,0,0,.34)', backdropFilter: 'blur(6px)',
          fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
        }}
      >
        <span style={{ fontSize: 'clamp(7px,1.5vw,8.5px)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,.5)', whiteSpace: 'nowrap' }}>powered by</span>
        <svg viewBox="0 0 1080 1080" width="15" height="15" style={{ display: 'block', flexShrink: 0 }} aria-hidden="true">
          <path fill="#fff" d="M877.5,295.97V109.03c0-10.51-8.52-19.03-19.03-19.03h-430.97c-10.51,0-19.03,8.52-19.03,19.03v147.53c0,25.23-10.02,49.44-27.87,67.28l-155.81,155.81c-14.28,14.27-22.29,33.64-22.29,53.82v437.5c0,10.51,8.52,19.03,19.03,19.03h636.94c10.51,0,19.03-8.52,19.03-19.03v-186.94c0-10.51-8.52-19.03-19.03-19.03h-421.46c-5.25,0-9.51-4.26-9.51-9.51v-402.43c0-21.02,17.04-38.06,38.06-38.06h392.91c10.51,0,19.03-8.52,19.03-19.03Z"/>
        </svg>
        <span style={{ fontSize: 'clamp(11px,2vw,13px)', fontWeight: 800, letterSpacing: '.1em', color: '#fff' }}>CLUDE</span>
      </a>

      {/* Hover / usage hint (bottom-left) — on mobile it sits ABOVE the pill row so
          the pills never cover it */}
      <div style={{
        position: 'absolute', left: 'clamp(16px,3vw,34px)', right: isNarrow ? 'clamp(16px,3vw,34px)' : undefined,
        bottom: isNarrow ? 76 : 'clamp(14px,3vh,22px)', zIndex: 3,
        fontSize: isNarrow ? 10 : 'clamp(10px,1.1vw,11.5px)', letterSpacing: '.05em', color: '#5aa877', pointerEvents: 'none', maxWidth: isNarrow ? undefined : '80vw',
      }}>
        {isTouch ? 'tap any star to read the tweet' : 'hover any star to read the tweet'} · brightest = most-liked · tap “Speak to Ansem” to talk
        <div style={{ marginTop: 4, color: '#3c6b52', fontSize: 'clamp(9.5px,1vw,11px)' }}>
          {isTouch ? 'drag to orbit · pinch to fly through' : 'drag to orbit · scroll to fly through · double-click to reset'}
        </div>
      </div>

      {loading && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'rgba(147,232,178,.5)', letterSpacing: 1 }}>Summoning the constellation…</div>
        </div>
      )}

      {error && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10, textAlign: 'center', color: '#ef4444', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* "$ANSEM LIVE" ranked social feed — top-left collapsible rail. Self-hides
          when the server has no X_SEARCH_BEARER. Docked away from the bottom-right
          "Speak to Ansem" orb + the center constellation. */}
      {!loading && !error && <AnsemFeed />}

      {!loading && !error && (
        <AnsemChat
          onHighlight={setHighlightIds}
          onChainClick={() => setChainOpen(true)}
          chainEnabled={chainStat?.enabled ?? true}
        />
      )}
    </div>
  );
}
