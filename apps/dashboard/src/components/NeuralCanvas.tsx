import { useEffect, useRef } from 'react';

const COLORS = ['#2244ff', '#10b981', '#f59e0b', '#8b5cf6'];

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  color: string;
  radius: number;
  phase: number;
  firing: boolean;
  fire: number;
}

export function NeuralCanvas({
  height = 200,
  opacity = 0.5,
  count = 35,
  dark = false,
}: {
  height?: number;
  opacity?: number;
  count?: number;
  dark?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    let w = 0, h = 0;

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: Math.random() * (w || 800),
      y: Math.random() * (h || 200),
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      radius: 1.5 + Math.random() * 1,
      phase: Math.random() * Math.PI * 2,
      firing: false,
      fire: 0,
    }));

    const timer = setInterval(() => {
      const p = particles[Math.floor(Math.random() * particles.length)];
      p.firing = true;
      p.fire = 1;
    }, 1200);

    let frame: number;

    function draw() {
      ctx.clearRect(0, 0, w, h);

      // Update particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.phase += 0.015;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        p.x = Math.max(0, Math.min(w, p.x));
        p.y = Math.max(0, Math.min(h, p.y));
        if (p.firing) {
          p.fire *= 0.965;
          if (p.fire < 0.01) { p.firing = false; p.fire = 0; }
        }
      }

      // Draw connections
      const connRadius = Math.min(120, w * 0.15);
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i], b = particles[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < connRadius) {
            const lineAlpha = (1 - dist / connRadius) * 0.12;
            const boost = Math.max(a.fire, b.fire);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            if (dark) {
              ctx.strokeStyle = `rgba(100,140,255,${lineAlpha + boost * 0.3})`;
            } else {
              ctx.strokeStyle = `rgba(34,68,255,${lineAlpha + boost * 0.25})`;
            }
            ctx.lineWidth = 0.5 + boost * 1.5;
            ctx.stroke();
            // Propagate fire to neighbors
            if (a.firing && dist < connRadius * 0.65) {
              b.firing = true;
              b.fire = Math.max(b.fire, a.fire * 0.35);
            }
            if (b.firing && dist < connRadius * 0.65) {
              a.firing = true;
              a.fire = Math.max(a.fire, b.fire * 0.35);
            }
          }
        }
      }

      // Draw particles
      for (const p of particles) {
        const pulse = 0.35 + 0.3 * Math.sin(p.phase);
        const a = pulse + p.fire * 0.65;
        const r = p.radius + p.fire * 2.5;

        // Glow on firing
        if (p.fire > 0.08) {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
          const glowAlpha = Math.floor(p.fire * 35).toString(16).padStart(2, '0');
          g.addColorStop(0, p.color + glowAlpha);
          g.addColorStop(1, 'transparent');
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 5, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        }

        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      frame = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      window.removeEventListener('resize', resize);
    };
  }, [count, dark]);

  return (
    <canvas
      ref={ref}
      style={{ width: '100%', height, display: 'block', opacity }}
    />
  );
}
