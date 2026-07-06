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
      build();
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
      ctx!.clearRect(0, 0, W, H);
      ctx!.globalCompositeOperation = 'lighter';           // additive light — the glow look
      for (let b = 0; b < 3; b++) { const [ox, oy] = bucketOff(b); ctx!.drawImage(edgeLayers[b].cv, ox, oy, W, H); }
      for (const n of nodes) {
        const [ox, oy] = bucketOff(zBucket(n.z));
        const x = n.x + ox, y = n.y + oy;
        // chat→highlight: recalled memories pulse + enlarge + brighten; rest dim.
        const isHl = hasHl && n.id !== undefined && hl.has(n.id);
        const dim = hasHl && !isHl ? 0.22 : 1;
        const pulse = isHl ? 1.35 + 0.35 * Math.sin(t * 3.4 + n.ph) : 1;
        if (n.bright) {
          const tw = 0.74 + 0.26 * Math.sin(t * 1.1 + n.ph);
          const R = n.r * 4.6 * tw * pulse;
          ctx!.globalAlpha = 0.85 * tw * dim;
          ctx!.drawImage(SPR_STAR, x - R, y - R, R * 2, R * 2);
        } else {
          const tw = (0.55 + 0.45 * Math.sin(t * (n.sp || 1) + n.ph));
          const depth = 0.5 + 0.5 * n.z;
          ctx!.globalAlpha = Math.min(1, (n.a || 0.4) * tw * depth * 1.5) * dim;
          const spr = n.glow ? SPR_STAR : (n.g ? SPR_GLOW : SPR_DOT);
          const R = n.r * (n.glow ? 4 : 2.6) * pulse;
          ctx!.drawImage(spr, x - R, y - R, R * 2, R * 2);
        }
        // recalled-star ring — the "graph responds to the conversation" moment
        if (isHl) {
          ctx!.globalAlpha = 0.6 + 0.4 * Math.sin(t * 3.4 + n.ph);
          ctx!.strokeStyle = 'rgba(140,255,180,0.9)'; ctx!.lineWidth = 1.2;
          ctx!.beginPath(); ctx!.arc(x, y, (n.bright ? n.r * 2.2 : 6) + 5 * pulse, 0, 6.2832); ctx!.stroke();
        }
      }
      ctx!.globalAlpha = 1;
      if (hover) {
        const [ox, oy] = bucketOff(zBucket(hover.z));
        ctx!.globalCompositeOperation = 'source-over';
        ctx!.strokeStyle = 'rgba(234,255,240,.92)'; ctx!.lineWidth = 1.4;
        ctx!.beginPath(); ctx!.arc(hover.x + ox, hover.y + oy, (hover.bright ? hover.r * 2.2 : 5) + 3, 0, 6.2832); ctx!.stroke();
      }
      ctx!.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }

    let hover: StarNode | null = null;
    function pick(mx: number, my: number): StarNode | null {
      let best: StarNode | null = null, bd = 1e9;
      for (const n of dataNodes) {
        const [ox, oy] = bucketOff(zBucket(n.z));
        const d = (n.x + ox - mx) ** 2 + (n.y + oy - my) ** 2;
        const hit = n.bright ? Math.max(16, n.r * 2.6) : 9;
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
    const onMove = (e: MouseEvent) => {
      const rc = wrap!.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
      txp = (mx / W - 0.5) * 2; typ = (my / H - 0.5) * 2;
      const n = pick(mx, my);
      if (n) { hover = n; moveTip(mx, my, n); } else if (hover) { hover = null; tip!.classList.remove('on'); }
    };
    const onLeave = () => { hover = null; tip!.classList.remove('on'); txp = 0; typ = 0; };
    const onTouch = (e: TouchEvent) => {
      const rc = wrap!.getBoundingClientRect(), tch = e.touches[0], mx = tch.clientX - rc.left, my = tch.clientY - rc.top;
      const n = pick(mx, my); if (n) { hover = n; moveTip(mx, my, n); } else { hover = null; tip!.classList.remove('on'); }
    };
    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', onLeave);
    wrap.addEventListener('touchstart', onTouch, { passive: true });

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
      wrap.removeEventListener('touchstart', onTouch);
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
}: {
  onHighlight: (ids: Set<number>) => void;
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
    try {
      const res = await fetch(`${API_BASE}/api/ansem/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      // 501 voice_not_configured (or any non-OK) → graceful fallback to synthetic
      if (!res.ok) return false;
      const data = (await res.json()) as { audio_url?: string };
      audioUrl = data.audio_url || '';
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

      {/* ── Collapsed: floating "Speak to Ansem" orb (bottom-right) ───────────── */}
      {!open && (
        <button
          className="ansem-orb"
          onClick={() => setOpen(true)}
          aria-label="Speak to Ansem"
          style={{
            position: 'fixed', right: 'clamp(16px,3vw,28px)', bottom: 'clamp(16px,3vh,28px)', zIndex: 40,
            display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px 13px 15px',
            borderRadius: 999, cursor: 'pointer',
            background: 'linear-gradient(180deg, rgba(6,26,16,.96), rgba(2,14,8,.96))',
            border: '1px solid rgba(72,224,122,.5)', backdropFilter: 'blur(8px)',
            animation: 'ansemOrbPulse 2.6s ease-in-out infinite',
            fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
          }}
        >
          <span style={{
            width: 11, height: 11, borderRadius: '50%', flexShrink: 0,
            background: '#5cf08a', boxShadow: '0 0 14px #3ddc73',
          }} />
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#eafff0' }}>
            Speak to Ansem
          </span>
        </button>
      )}

      {/* ── Expanded: floating conversation window ────────────────────────────── */}
      {open && (
        <div style={{
          position: 'fixed', right: 'clamp(12px,3vw,28px)', bottom: 'clamp(12px,3vh,28px)', zIndex: 40,
          width: 'min(380px, calc(100vw - 24px))', height: 'min(560px, calc(100dvh - 24px))',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          borderRadius: 18, border: '1px solid rgba(72,224,122,.34)',
          background: 'rgba(2,12,7,.94)', backdropFilter: 'blur(12px)',
          boxShadow: '0 20px 70px rgba(0,0,0,.72), 0 0 34px rgba(34,197,94,.12)',
          animation: 'ansemPanelIn .28s cubic-bezier(.2,.8,.2,1)',
          fontFamily: "ui-monospace,'SF Mono',Menlo,monospace",
        }}>
          {/* (a) the neural-wave bull avatar — the "face" of the clone (~square top) */}
          <div style={{ position: 'relative', height: 240, flexShrink: 0, background: '#000', borderBottom: '1px solid rgba(72,224,122,.18)' }}>
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

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setHighlightIds(new Set()); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const countLabel = useMemo(() => (total || 38303).toLocaleString(), [total]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden', fontFamily: "ui-monospace,'SF Mono',Menlo,monospace" }}>
      {!loading && !error && <BullConstellation nodes={nodes} highlightIds={highlightIds} />}

      {/* HUD — title, subtitle, count, disclaimer */}
      <div style={{
        position: 'absolute', left: 'clamp(16px,3vw,34px)', top: 'clamp(14px,3vh,26px)',
        pointerEvents: 'none', zIndex: 3, textShadow: '0 0 20px rgba(0,0,0,.95)',
      }}>
        <div style={{ fontWeight: 800, fontSize: 'clamp(28px,4.6vw,44px)', letterSpacing: '.16em', color: '#eafff0', lineHeight: 1 }}>
          $ANSEM
        </div>
        <div style={{ fontSize: 'clamp(10px,1.3vw,12.5px)', letterSpacing: '.36em', color: '#3ddc73', marginTop: 7, textTransform: 'uppercase' }}>
          the memory constellation
        </div>
        <div style={{ fontSize: 'clamp(9.5px,1.1vw,11px)', letterSpacing: '.16em', color: '#7fd8a0', marginTop: 5, textTransform: 'uppercase' }}>
          what the timeline is saying
        </div>
        <div style={{ fontSize: 'clamp(10.5px,1.2vw,12px)', color: '#7fd8a0', marginTop: 13, letterSpacing: '.02em' }}>
          <span style={{ color: '#5cf08a', fontVariantNumeric: 'tabular-nums' }}>{countLabel}</span> memories
        </div>
        <div style={{ fontSize: 'clamp(10px,1.1vw,11.5px)', color: '#5aa877', marginTop: 6, letterSpacing: '.02em', maxWidth: 340 }}>
          AI clone — not the real person · <span style={{ color: '#3c6b52' }}>not financial advice</span>
        </div>
      </div>

      {/* Hover / usage hint (bottom-left) */}
      <div style={{
        position: 'absolute', left: 'clamp(16px,3vw,34px)', bottom: 'clamp(14px,3vh,22px)', zIndex: 3,
        fontSize: 'clamp(10px,1.1vw,11.5px)', letterSpacing: '.05em', color: '#5aa877', pointerEvents: 'none', maxWidth: '80vw',
      }}>
        hover any star to read the tweet · brightest = most-liked · tap “Speak to Ansem” to talk
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

      {!loading && !error && <AnsemChat onHighlight={setHighlightIds} />}
    </div>
  );
}
