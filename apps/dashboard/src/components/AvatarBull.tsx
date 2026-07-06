/**
 * AvatarBull — the talking "stealth bull" face of the $ANSEM clone.
 *
 * The render engine is PORTED VERBATIM in behavior from
 * scratchpad/avatar-talking.html (the FINAL, screenshot-approved talking bull):
 *   • THREE image frames — mouth closed / open-moderate / open-wide — cross-faded
 *     on the speech envelope (`open`), so the mouth opens with the voice.
 *   • Glowing GREEN eyes at image-relative positions [0.433,0.508] and
 *     [0.573,0.508] that slowly dart, blink, and brighten with amp.
 *   • A head bob (translate / rotate / scale) applied under ONE transform, so the
 *     eyes and mouth ride the head.
 *   • Constant green particles streaming off BOTH flank regions (denser + faster
 *     with amp) + an ambient green glow that breathes with the voice.
 *   • Everything driven by `amp` (0..1) which smooths toward a target. When idle
 *     (no external drive) it runs the built-in `sim()` speech envelope.
 *
 * Fidelity guards preserved from the source / the prior component:
 *   • The three frames are drawn "cover-fit" (fill the container, crop overflow),
 *     identical to the source's ir/cr math.
 *   • resize() guards on tiny/zero dimensions (W<2||H<2 → bail) so the very first
 *     frame before layout doesn't build against a 0-dim canvas — this is what
 *     avoided the earlier black-render bug. There is NO offscreen dynamic canvas.
 *   • frame() retries resize() until W/H are real, so the avatar appears as soon
 *     as the (CSS-transitioned) panel has laid out.
 *
 * React seam: instead of a global `window.setAmp`, the component exposes an
 * imperative handle `{ setAmp(v: 0..1) }` via ref. Calling setAmp flips the
 * avatar out of its idle-sim loop toward the supplied target amplitude, exactly
 * like the original `window.setAmp`. The page drives this from the real TTS audio
 * (Web Audio AnalyserNode RMS) while a reply plays, or a synthetic flutter when
 * no audio is available.
 */
import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';

import imgClosed from '../assets/ansem/bull-stealth-3.png';
import imgOpen1 from '../assets/ansem/bull-open-1.png';
import imgOpen2 from '../assets/ansem/bull-open-2.png';

export interface AvatarBullHandle {
  /** Drive the mouth/eyes/head. 0 = idle-quiet, 1 = full "talking". */
  setAmp: (v: number) => void;
}

interface Particle {
  x: number; y: number; vx: number; vy: number; s: number; life: number; rot: boolean;
}

export const AvatarBull = forwardRef<AvatarBullHandle, { className?: string; style?: React.CSSProperties }>(
  function AvatarBull({ className, style }, ref) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // amp control lives in refs so the imperative handle can poke it without re-render
    const targetRef = useRef(0);
    const liveRef = useRef(false);

    useImperativeHandle(ref, () => ({
      setAmp: (v: number) => {
        liveRef.current = true;
        targetRef.current = Math.max(0, Math.min(1, +v || 0));
      },
    }), []);

    useEffect(() => {
      const wrap = wrapRef.current;
      const cv = canvasRef.current;
      if (!wrap || !cv) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;

      // ── load the three mouth frames (Vite-bundled asset URLs) ──────────────
      const IMG: { closed: HTMLImageElement; open1: HTMLImageElement; open2: HTMLImageElement } = {
        closed: new Image(),
        open1: new Image(),
        open2: new Image(),
      };
      let ready = 0;
      const onLoad = () => { ready++; };
      IMG.closed.onload = onLoad; IMG.closed.src = imgClosed;
      IMG.open1.onload = onLoad; IMG.open1.src = imgOpen1;
      IMG.open2.onload = onLoad; IMG.open2.src = imgOpen2;

      let W = 0, H = 0, DPR = 1;
      function resize() {
        DPR = Math.min(2, window.devicePixelRatio || 1);
        W = wrap!.clientWidth || 0; H = wrap!.clientHeight || 0;
        if (W < 2 || H < 2) { return; }   // guard: never build against a 0-dim canvas
        cv!.width = Math.round(W * DPR); cv!.height = Math.round(H * DPR);
        cv!.style.width = W + 'px'; cv!.style.height = H + 'px';
        ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      }

      let amp = 0;
      // idle simulated-speech envelope (verbatim from the source) — used until
      // setAmp() is called (liveRef flips true).
      function sim(t: number): number {
        const gate = (Math.sin(t * 0.75) * 0.5 + 0.5) > 0.32 ? 1 : 0;
        return gate * (0.35 + 0.65 * Math.abs(Math.sin(t * 11)) * Math.abs(Math.sin(t * 6.4 + 1)));
      }

      // particle field — continuous green dissolve streaming off both flank regions
      let parts: Particle[] = [];
      function spawn(n: number, energy: number) {
        for (let i = 0; i < n; i++) {
          const right = Math.random() < 0.5;
          const bx = right ? W * (0.66 + Math.random() * 0.12) : W * (0.22 + Math.random() * 0.12);
          const by = H * (0.24 + Math.random() * 0.5);
          parts.push({
            x: bx, y: by,
            vx: (right ? 1 : -1) * (0.3 + Math.random() * 1.6) * (0.6 + energy),
            vy: -0.4 + Math.random() * 1.4 - energy * 0.4,
            s: 0.8 + Math.random() * 2.2, life: 1, rot: Math.random() < 0.5,
          });
        }
      }

      const t0 = performance.now();
      let raf = 0;
      function frame(now: number) {
        if (W < 2 || H < 2) { resize(); raf = requestAnimationFrame(frame); return; }
        const t = (now - t0) / 1000;

        // idle → simulated speech; once setAmp() has been called, follow the driven target
        let tgt = liveRef.current ? targetRef.current : sim(t);
        tgt = Math.max(0, Math.min(1, tgt));
        amp += (tgt - amp) * 0.3;

        ctx!.clearRect(0, 0, W, H);
        if (ready < 3) { raf = requestAnimationFrame(frame); return; }

        // head motion: gentle idle sway + syllable bob when speaking
        const dx = Math.sin(t * 0.8) * W * 0.004 + Math.sin(t * 2.4) * W * 0.004 * amp;
        const dy = Math.sin(t * 1.25) * H * 0.006 + Math.abs(Math.sin(t * 7.5)) * H * 0.012 * amp;
        const rot = Math.sin(t * 0.7) * 0.008 + Math.sin(t * 5.5) * 0.012 * amp;
        const sc = 1 + 0.015 * Math.sin(t * 1.1) + 0.02 * amp;

        // ambient green glow behind, breathing with the voice
        ctx!.globalCompositeOperation = 'lighter';
        const gg = ctx!.createRadialGradient(W / 2, H * 0.46, 0, W / 2, H * 0.46, Math.min(W, H) * (0.34 + amp * 0.16));
        gg.addColorStop(0, 'rgba(30,140,80,' + (0.10 + amp * 0.22) + ')');
        gg.addColorStop(1, 'rgba(20,120,70,0)');
        ctx!.fillStyle = gg; ctx!.fillRect(0, 0, W, H);
        ctx!.globalCompositeOperation = 'source-over';

        // ── head frame: mouth cross-fade + moving eyes, all under ONE transform ──
        const ir = IMG.closed.width / IMG.closed.height, cr = W / H;
        let iw: number, ih: number;
        if (ir > cr) { ih = H; iw = ih * ir; } else { iw = W; ih = iw / ir; }
        const open = amp * (0.45 + 0.55 * Math.abs(Math.sin(t * 13.5)));  // rapid syllable flutter
        ctx!.save();
        ctx!.translate(W / 2 + dx, H / 2 + dy); ctx!.rotate(rot); ctx!.scale(sc, sc);
        ctx!.globalCompositeOperation = 'source-over';
        ctx!.globalAlpha = 1; ctx!.drawImage(IMG.closed, -iw / 2, -ih / 2, iw, ih);
        if (open > 0.03) { ctx!.globalAlpha = Math.min(1, open * 1.7); ctx!.drawImage(IMG.open1, -iw / 2, -ih / 2, iw, ih); }
        if (open > 0.6) { ctx!.globalAlpha = (open - 0.6) / 0.4; ctx!.drawImage(IMG.open2, -iw / 2, -ih / 2, iw, ih); }
        ctx!.globalAlpha = 1;

        // eyes — glowing green, slow darting look-around + occasional blink, brighter when speaking
        const edx = (Math.sin(t * 0.5) * 0.006 + Math.sin(t * 1.7 + 2) * 0.004) * iw;
        const edy = (Math.sin(t * 0.4 + 1) * 0.004 + Math.abs(Math.sin(t * 9)) * 0.003 * amp) * ih;
        const bph = (t * 0.32) % 1;
        const blink = bph > 0.955 ? Math.max(0.06, Math.abs(Math.cos((bph - 0.955) / 0.045 * Math.PI))) : 1;
        ctx!.globalCompositeOperation = 'lighter';
        for (const [u, v] of [[0.433, 0.508], [0.573, 0.508]] as Array<[number, number]>) {
          const lx = (u - 0.5) * iw + edx, ly = (v - 0.5) * ih + edy, R = ih * 0.014 * (0.85 + 0.35 * amp);
          const gr = ctx!.createRadialGradient(lx, ly, 0, lx, ly, R * 4);
          gr.addColorStop(0, 'rgba(190,255,205,0.9)');
          gr.addColorStop(0.25, 'rgba(70,255,140,0.55)');
          gr.addColorStop(0.6, 'rgba(50,220,110,0.16)');
          gr.addColorStop(1, 'rgba(50,220,110,0)');
          ctx!.save(); ctx!.translate(lx, ly); ctx!.scale(1, blink);
          ctx!.fillStyle = gr; ctx!.beginPath(); ctx!.arc(0, 0, R * 4, 0, 6.3); ctx!.fill();
          ctx!.fillStyle = 'rgba(210,255,220,' + (0.85 * blink).toFixed(2) + ')';
          ctx!.beginPath(); ctx!.arc(0, 0, R * 0.5, 0, 6.3); ctx!.fill();
          ctx!.restore();
        }
        ctx!.restore();

        // constant streaming particles (denser + faster when speaking)
        ctx!.globalCompositeOperation = 'lighter';
        spawn(1 + ((Math.random() < amp * 1.5) ? 2 : 0), amp);
        for (const p of parts) {
          p.x += p.vx * (1 + amp); p.y += p.vy; p.vy += 0.006; p.life -= 0.011;
          if (p.life > 0) {
            ctx!.fillStyle = 'rgba(120,240,150,' + (p.life * 0.75).toFixed(3) + ')';
            if (p.rot) { ctx!.fillRect(p.x, p.y, p.s, p.s); }
            else { ctx!.beginPath(); ctx!.arc(p.x, p.y, p.s * 0.6, 0, 6.3); ctx!.fill(); }
          }
        }
        parts = parts.filter((p) => p.life > 0).slice(-360);
        ctx!.globalCompositeOperation = 'source-over';

        raf = requestAnimationFrame(frame);
      }

      let rt = 0;
      const onResize = () => { clearTimeout(rt); rt = window.setTimeout(resize, 120); };
      window.addEventListener('resize', onResize);

      // The panel expands with a CSS transition; the wrap may be 0-dim on the first
      // few frames. resize() bails until it has real dimensions, and frame() retries
      // resize() every frame until W/H are set — so the avatar builds once laid out.
      resize();
      if (W < 2 || H < 2) setTimeout(resize, 60);
      raf = requestAnimationFrame(frame);

      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(rt);
        window.removeEventListener('resize', onResize);
      };
    }, []);

    return (
      <div ref={wrapRef} className={className} style={style}>
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      </div>
    );
  },
);
