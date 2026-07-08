/**
 * Constellation — a private view for the ansem@clude.io account ONLY.
 *
 * His 38,303 seeded memories rendered as a living star-constellation in the
 * shape of a bull (black bull mode): additive-blended glow sprites, a faint
 * background starfield, parallax depth layers, and a pre-rendered constellation
 * mesh. The 300 most-liked posts are the bright hoverable stars; his two
 * MOST-liked memories are pinned as the bull's eyes. Data is a static bundle
 * (built from his X corpus at seed time), lazy-loaded so other accounts never
 * download it. Route + nav are gated on the signed-in Privy email.
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthContext } from '../hooks/AuthContext';

export const ANSEM_EMAIL = 'ansem@clude.io';

type BrightNode = { t: string; l: number };
type ConstellationData = {
  bright: BrightNode[];
  faint: BrightNode[];
  total: number;
  posts: number;
  replies: number;
};

type Star = {
  x: number; y: number; z: number;
  r: number; ph: number; sp?: number; a?: number;
  bright: boolean; out?: boolean; g?: boolean; glow?: boolean;
  t?: string; l?: number;
};

// Bull-head silhouette in 1000-space as SEPARATE parts union'd in inside() —
// a single Path2D lets opposite-winding subpaths carve holes (the ragged-cheek
// bug); testing each part independently keeps every part additive.
const PART_DEFS = [
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
  // ears — protrude OUT from the cheeks (overlap the face edge → union)
  'M335,480 C275,462 222,492 228,542 C262,570 312,562 340,542 Z',
  'M665,480 C725,462 778,492 772,542 C738,570 688,562 660,542 Z',
];

function makeSprite(stops: Array<[number, string]>): HTMLCanvasElement {
  const s = document.createElement('canvas');
  s.width = s.height = 128;
  const g = s.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return s;
}

export function Constellation() {
  const { email } = useAuthContext();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ConstellationData | null>(null);
  const [entered, setEntered] = useState(false);

  const isAnsem = (email || '').toLowerCase() === ANSEM_EMAIL;

  // Lazy-load the corpus bundle only when this (gated) page actually mounts.
  useEffect(() => {
    if (!isAnsem) return;
    let alive = true;
    import('../data/ansem-constellation.json').then((m) => {
      if (alive) setData((m as { default: ConstellationData }).default ?? (m as unknown as ConstellationData));
    });
    return () => { alive = false; };
  }, [isAnsem]);

  // The special entrance: fade the whole constellation up once data is in.
  useEffect(() => {
    if (!data) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setEntered(true); return; }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    return () => cancelAnimationFrame(id);
  }, [data]);

  useEffect(() => {
    if (!data || !wrapRef.current || !canvasRef.current) return;
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    const ctx = cv.getContext('2d')!;
    const tip = tipRef.current!;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const PARTS = PART_DEFS.map((d) => new Path2D(d));
    const tcv = document.createElement('canvas');
    tcv.width = tcv.height = 1000;
    const tctx = tcv.getContext('2d')!;
    const inside = (x: number, y: number) => {
      for (const p of PARTS) { if (tctx.isPointInPath(p, x, y)) return true; }
      return false;
    };

    const SPR_STAR = makeSprite([[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(214,255,228,0.9)'], [0.3, 'rgba(92,240,138,0.45)'], [0.62, 'rgba(40,180,90,0.12)'], [1, 'rgba(40,180,90,0)']]);
    const SPR_GLOW = makeSprite([[0, 'rgba(120,255,170,0.65)'], [0.35, 'rgba(60,224,120,0.28)'], [1, 'rgba(60,224,120,0)']]);
    const SPR_DOT = makeSprite([[0, 'rgba(235,255,242,0.9)'], [0.4, 'rgba(160,240,190,0.25)'], [1, 'rgba(160,240,190,0)']]);

    const BRIGHT = data.bright, FAINT = data.faint;
    const maxL = Math.max(1, ...BRIGHT.map((b) => b.l || 0));

    let W = 0, H = 0, S = 0, OX = 0, OY = 0, DPR = 1;
    let nodes: Star[] = [], dataNodes: Star[] = [];
    let edgeLayers: HTMLCanvasElement[] = [];
    let raf = 0;
    let hover: Star | null = null;
    let txp = 0, typ = 0, pxp = 0, pyp = 0;

    const mkRnd = () => { let s = 20240704; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); };
    const toCanvas = (x: number, y: number): [number, number] => [OX + (x / 1000) * S, OY + (y / 1000) * S];
    const to1000 = (cx: number, cy: number): [number, number] => [((cx - OX) / S) * 1000, ((cy - OY) / S) * 1000];
    const zBucket = (z: number) => (z < 0.55 ? 0 : z < 0.8 ? 1 : 2);
    const bucketOff = (b: number): [number, number] => { const k = [5, 11, 19][b]; return [pxp * k, pyp * k * 0.66]; };

    function build() {
      const rnd = mkRnd();
      nodes = []; dataNodes = [];

      // background starfield — the bull emerges FROM a field of stars
      const NBG = Math.round((520 * (W * H)) / (1440 * 900));
      for (let i = 0; i < NBG; i++) {
        const cx = rnd() * W, cy = rnd() * H;
        const [qx, qy] = to1000(cx, cy);
        if (qx >= 0 && qx <= 1000 && qy >= 0 && qy <= 1000 && inside(qx, qy)) { i--; continue; }
        const big = rnd() < 0.05;
        nodes.push({ x: cx, y: cy, z: 0.3 + rnd() * 0.22, out: true, bright: false, r: big ? 1.6 + rnd() * 1.4 : 0.5 + rnd() * 0.9, glow: big, g: rnd() < 0.45, a: big ? 0.4 + rnd() * 0.3 : 0.1 + rnd() * 0.26, ph: rnd() * 6.28, sp: 0.4 + rnd() * 1.0 });
      }

      // interior data stars (real memories, hoverable)
      for (const d of FAINT) {
        let x = 0, y = 0, g = 0;
        do { x = rnd() * 1000; y = rnd() * 1000; g++; } while (!inside(x, y) && g < 80);
        const [cx, cy] = toCanvas(x, y);
        const near = !inside(x - 9, y) || !inside(x + 9, y) || !inside(x, y - 9) || !inside(x, y + 9);
        const n: Star = { x: cx, y: cy, z: 0.45 + rnd() * 0.45, out: false, bright: false, t: d.t, l: d.l, r: (near ? 1.5 : 0.95) + rnd() * 1.0, g: rnd() < (near ? 0.75 : 0.5), a: (near ? 0.5 : 0.34) + rnd() * 0.4, ph: rnd() * 6.28, sp: 0.6 + rnd() * 1.4 };
        nodes.push(n); dataNodes.push(n);
      }

      // interior FILLER stars — densify the mesh, boundary-biased (rim light)
      const NFILL = Math.round(1200 * Math.min(1.35, (W * H) / (1440 * 900)));
      let placed = 0, guard = 0;
      while (placed < NFILL && guard < NFILL * 50) {
        guard++;
        const x = rnd() * 1000, y = rnd() * 1000;
        if (!inside(x, y)) continue;
        const near = !inside(x - 10, y) || !inside(x + 10, y) || !inside(x, y - 10) || !inside(x, y + 10);
        if (!near && rnd() < 0.45) continue;
        const [cx, cy] = toCanvas(x, y);
        nodes.push({ x: cx, y: cy, z: 0.35 + rnd() * 0.5, out: false, bright: false, r: (near ? 1.3 : 0.8) + rnd() * 0.9, g: rnd() < (near ? 0.8 : 0.5), a: (near ? 0.45 : 0.25) + rnd() * 0.35, ph: rnd() * 6.28, sp: 0.6 + rnd() * 1.5 });
        placed++;
      }

      // bright memory-stars — his TWO most-liked memories are the bull's EYES
      const EYES: Array<[number, number]> = [[420, 534], [580, 534]];
      BRIGHT.forEach((d, bi) => {
        let x = 0, y = 0, g = 0;
        if (bi < 2) { x = EYES[bi][0]; y = EYES[bi][1]; }
        else { do { x = rnd() * 1000; y = rnd() * 1000; g++; } while (!inside(x, y) && g < 80); }
        const [cx, cy] = toCanvas(x, y);
        const pop = (d.l || 0) / maxL;
        const n: Star = { x: cx, y: cy, z: bi < 2 ? 1 : 0.72 + 0.28 * Math.pow(pop, 0.4), out: false, bright: true, t: d.t, l: d.l, r: bi < 2 ? Math.max(9.5, 2.2 + 8.2 * Math.pow(pop, 0.5)) : 2.2 + 8.2 * Math.pow(pop, 0.5), ph: rnd() * 6.28 };
        nodes.push(n); dataNodes.push(n);
      });

      // constellation mesh — pre-rendered per z-bucket (parallax layers)
      edgeLayers = [];
      for (let b = 0; b < 3; b++) {
        const layer = document.createElement('canvas');
        layer.width = cv.width; layer.height = cv.height;
        const lc = layer.getContext('2d')!;
        lc.setTransform(DPR, 0, 0, DPR, 0, 0);
        edgeLayers.push(layer);
        const bucketNodes = nodes.map((n, i) => ({ n, i })).filter((o) => zBucket(o.n.z) === b);
        const cell = Math.max(16, S * 0.034);
        const grid: Record<string, Array<{ n: Star; i: number }>> = {};
        bucketNodes.forEach((o) => { const k = ((o.n.x / cell) | 0) + ',' + ((o.n.y / cell) | 0); (grid[k] || (grid[k] = [])).push(o); });
        const Rin = S * 0.052, Rout = S * 0.055;
        lc.lineWidth = 0.6;
        bucketNodes.forEach((o) => {
          const n = o.n, R = n.out ? Rout : Rin, R2 = R * R, cap = n.out ? 2 : 4;
          const gx = (n.x / cell) | 0, gy = (n.y / cell) | 0;
          let cnt = 0;
          for (let dx = -1; dx <= 1 && cnt < cap; dx++) for (let dy = -1; dy <= 1 && cnt < cap; dy++) {
            const c = grid[(gx + dx) + ',' + (gy + dy)];
            if (!c) continue;
            for (const p of c) {
              if (p.i <= o.i) continue;
              const m = p.n;
              if (m.out !== n.out) continue; // never bridge the silhouette
              const d2 = (n.x - m.x) ** 2 + (n.y - m.y) ** 2;
              if (d2 < R2) {
                const base = n.out ? 0.05 : 0.1;
                const a = base + (1 - Math.sqrt(d2) / R) * (n.out ? 0.09 : 0.2);
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
      W = wrap.clientWidth; H = wrap.clientHeight;
      if (W === 0 || H === 0) return;
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      S = Math.min(W, H) * 0.92; OX = (W - S) / 2; OY = (H - S) / 2 + H * 0.012;
      build();
    }

    const t0 = performance.now();
    function frame(now: number) {
      const t = reduce ? 0 : (now - t0) / 1000;
      if (!reduce) { pxp += (txp - pxp) * 0.045; pyp += (typ - pyp) * 0.045; }
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter'; // additive light — the glow look
      for (let b = 0; b < 3; b++) { const [ox, oy] = bucketOff(b); ctx.drawImage(edgeLayers[b], ox, oy, W, H); }
      for (const n of nodes) {
        const [ox, oy] = bucketOff(zBucket(n.z));
        const x = n.x + ox, y = n.y + oy;
        if (n.bright) {
          const tw = 0.74 + 0.26 * Math.sin(t * 1.1 + n.ph);
          const R = n.r * 4.6 * tw;
          ctx.globalAlpha = 0.85 * tw;
          ctx.drawImage(SPR_STAR, x - R, y - R, R * 2, R * 2);
        } else {
          const tw = 0.55 + 0.45 * Math.sin(t * (n.sp || 1) + n.ph);
          const depth = 0.5 + 0.5 * n.z;
          ctx.globalAlpha = Math.min(1, (n.a || 0.3) * tw * depth * 1.5);
          const spr = n.glow ? SPR_STAR : n.g ? SPR_GLOW : SPR_DOT;
          const R = n.r * (n.glow ? 4 : 2.6);
          ctx.drawImage(spr, x - R, y - R, R * 2, R * 2);
        }
      }
      ctx.globalAlpha = 1;
      if (hover) {
        const [ox, oy] = bucketOff(zBucket(hover.z));
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(234,255,240,.92)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(hover.x + ox, hover.y + oy, (hover.bright ? hover.r * 2.2 : 5) + 3, 0, 6.2832); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }

    function pick(mx: number, my: number): Star | null {
      let best: Star | null = null, bd = 1e9;
      for (const n of dataNodes) {
        const [ox, oy] = bucketOff(zBucket(n.z));
        const d = (n.x + ox - mx) ** 2 + (n.y + oy - my) ** 2;
        const hit = n.bright ? Math.max(16, n.r * 2.6) : 9;
        if (d < hit * hit && d < bd) { bd = d; best = n; }
      }
      return best;
    }
    function moveTip(mx: number, my: number, n: Star) {
      tip.textContent = n.t || '';
      const lk = document.createElement('span');
      lk.className = 'constellation-likes';
      lk.textContent = '♥ ' + (n.l || 0).toLocaleString();
      tip.appendChild(lk);
      tip.classList.add('on');
      let tx = mx + 16, ty = my + 14;
      if (tx > W - 350) tx = mx - 16 - (tip.offsetWidth || 300);
      if (ty > H - 96) ty = my - 14 - (tip.offsetHeight || 80);
      tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
    }

    const onMove = (e: MouseEvent) => {
      const rc = wrap.getBoundingClientRect();
      const mx = e.clientX - rc.left, my = e.clientY - rc.top;
      txp = (mx / W - 0.5) * 2; typ = (my / H - 0.5) * 2;
      const n = pick(mx, my);
      if (n) { hover = n; moveTip(mx, my, n); }
      else if (hover) { hover = null; tip.classList.remove('on'); }
    };
    const onLeave = () => { hover = null; tip.classList.remove('on'); txp = 0; typ = 0; };
    const onTouch = (e: TouchEvent) => {
      const rc = wrap.getBoundingClientRect();
      const tch = e.touches[0];
      const mx = tch.clientX - rc.left, my = tch.clientY - rc.top;
      const n = pick(mx, my);
      if (n) { hover = n; moveTip(mx, my, n); }
      else { hover = null; tip.classList.remove('on'); }
    };

    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', onLeave);
    wrap.addEventListener('touchstart', onTouch, { passive: true });
    const ro = new ResizeObserver(() => resize());
    ro.observe(wrap);

    resize();
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      wrap.removeEventListener('mousemove', onMove);
      wrap.removeEventListener('mouseleave', onLeave);
      wrap.removeEventListener('touchstart', onTouch);
    };
  }, [data]);

  // The gate: this page exists for the Ansem account only.
  if (!isAnsem) return <Navigate to="/" replace />;

  return (
    <div
      ref={wrapRef}
      style={{
        position: 'relative', width: '100%', height: '100vh', overflow: 'hidden',
        background: '#000', fontFamily: 'var(--mono, ui-monospace, monospace)',
        userSelect: 'none',
        opacity: entered ? 1 : 0, transition: 'opacity 1.4s ease',
      }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />
      {/* vignette */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none', background: 'radial-gradient(120% 100% at 50% 46%, rgba(0,0,0,0) 46%, rgba(0,0,0,.34) 74%, rgba(0,0,0,.72) 100%)' }} />
      {/* HUD */}
      <div style={{ position: 'absolute', left: 'clamp(16px,3vw,34px)', top: 'clamp(14px,3vh,26px)', pointerEvents: 'none', zIndex: 3, textShadow: '0 0 20px rgba(0,0,0,.95)' }}>
        <div style={{ fontWeight: 800, fontSize: 'clamp(28px,4.6vw,44px)', letterSpacing: '.24em', color: '#eafff0', lineHeight: 1 }}>ANSEM</div>
        <div style={{ fontSize: 'clamp(10px,1.3vw,12.5px)', letterSpacing: '.44em', color: '#3ddc73', marginTop: 7, textTransform: 'uppercase' }}>the memory constellation</div>
        <div style={{ fontSize: 'clamp(10.5px,1.2vw,12px)', color: '#7fd8a0', marginTop: 13 }}>
          <span style={{ color: '#5cf08a', fontVariantNumeric: 'tabular-nums' }}>{(data?.total ?? 38303).toLocaleString()}</span>
          {' memories · '}{(data?.posts ?? 0).toLocaleString()}{' posts · '}{(data?.replies ?? 0).toLocaleString()}{' replies'}
        </div>
        <div style={{ fontSize: 'clamp(10px,1.1vw,11.5px)', color: '#5aa877', marginTop: 5 }}>
          on-device AI clone · @AnsemClone · <span style={{ color: '#3c6b52' }}>not the real person</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 'clamp(16px,3vw,34px)', bottom: 'clamp(14px,3vh,22px)', zIndex: 3, fontSize: 'clamp(10px,1.1vw,11.5px)', letterSpacing: '.05em', color: '#5aa877', pointerEvents: 'none', maxWidth: '80vw' }}>
        hover any star to read the memory · brightest = most-liked · 🐂 black bull mode
      </div>
      {/* tooltip */}
      <div ref={tipRef} className="constellation-tip" />
      <style>{`
        .constellation-tip{position:absolute;z-index:5;max-width:min(330px,72vw);padding:11px 13px;border:1px solid rgba(72,224,122,.5);border-radius:10px;background:rgba(2,14,8,.95);backdrop-filter:blur(7px);color:#eafff0;font-size:13px;line-height:1.5;box-shadow:0 10px 44px rgba(0,0,0,.7),0 0 24px rgba(34,197,94,.22);opacity:0;transform:translateY(4px);transition:opacity .1s;pointer-events:none;white-space:pre-wrap}
        .constellation-tip.on{opacity:1;transform:translateY(0)}
        .constellation-likes{display:block;margin-top:7px;font-size:11px;color:#3ddc73;letter-spacing:.04em;font-variant-numeric:tabular-nums}
      `}</style>
    </div>
  );
}
