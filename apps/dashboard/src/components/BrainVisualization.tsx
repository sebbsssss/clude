import { useEffect, useRef, useState, useCallback } from 'react';
import type { Memory, MemoryType } from '../types/memory';

const TYPE_COLORS: Record<MemoryType, { r: number; g: number; b: number; hex: string }> = {
  episodic: { r: 34, g: 68, b: 255, hex: '#2244ff' },
  semantic: { r: 16, g: 185, b: 129, hex: '#10b981' },
  procedural: { r: 245, g: 158, b: 11, hex: '#f59e0b' },
  self_model: { r: 139, g: 92, b: 246, hex: '#8b5cf6' },
};

const TYPE_LABELS: Record<MemoryType, string> = {
  episodic: 'Episodic',
  semantic: 'Semantic',
  procedural: 'Procedural',
  self_model: 'Self-Model',
};

interface BrainNode {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  homeX: number;
  homeY: number;
  radius: number;
  type: MemoryType;
  importance: number;
  decay: number;
  summary: string;
  content: string;
  tags: string[];
  source: string;
  created_at: string;
  phase: number;
  fireLevel: number;
  spawning: number;
  solana_signature: string | null;
}

interface RiverParticle {
  curveIndex: number;
  t: number;
  speed: number;
  size: number;
  type: MemoryType;
}

interface PathwayCurve {
  type: MemoryType;
  points: { x: number; y: number }[];
}

interface Props {
  memories: Memory[];
  onSelectMemory?: (memory: Memory | null) => void;
  selectedMemoryId?: number | null;
  typeFilter?: Set<MemoryType>;
}

export function BrainVisualization({ memories, onSelectMemory, selectedMemoryId, typeFilter }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<BrainNode[]>([]);
  const particlesRef = useRef<RiverParticle[]>([]);
  const curvesRef = useRef<PathwayCurve[]>([]);
  const hoveredRef = useRef<number | null>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  // Generate cluster centers for each memory type
  const getClusterCenter = useCallback((type: MemoryType, w: number, h: number) => {
    const cx = w / 2, cy = h / 2;
    const spread = Math.min(w, h) * 0.28;
    const angles: Record<MemoryType, number> = {
      episodic: -Math.PI / 4,
      semantic: Math.PI / 4,
      procedural: (3 * Math.PI) / 4,
      self_model: -(3 * Math.PI) / 4,
    };
    return {
      x: cx + Math.cos(angles[type]) * spread,
      y: cy + Math.sin(angles[type]) * spread,
    };
  }, []);

  // Initialize/update nodes from memories
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;

    const existing = new Map(nodesRef.current.map((n) => [n.id, n]));
    const newNodes: BrainNode[] = [];

    for (const m of memories) {
      if (typeFilter && !typeFilter.has(m.memory_type)) continue;
      const ex = existing.get(m.id);
      if (ex) {
        ex.importance = m.importance;
        ex.decay = m.decay_factor;
        ex.summary = m.summary;
        newNodes.push(ex);
      } else {
        const center = getClusterCenter(m.memory_type, w, h);
        const jitter = 60 + Math.random() * 40;
        const angle = Math.random() * Math.PI * 2;
        newNodes.push({
          id: m.id,
          x: center.x + Math.cos(angle) * jitter,
          y: center.y + Math.sin(angle) * jitter,
          vx: 0,
          vy: 0,
          homeX: center.x + Math.cos(angle) * jitter,
          homeY: center.y + Math.sin(angle) * jitter,
          radius: 3 + m.importance * 6,
          type: m.memory_type,
          importance: m.importance,
          decay: m.decay_factor,
          summary: m.summary,
          content: m.content || '',
          tags: m.tags || [],
          source: m.source || '',
          created_at: m.created_at,
          phase: Math.random() * Math.PI * 2,
          fireLevel: 0,
          spawning: 1, // start with spawn animation
          solana_signature: m.solana_signature || null,
        });
      }
    }
    nodesRef.current = newNodes;

    // Generate pathway curves
    const types: MemoryType[] = ['episodic', 'semantic', 'procedural', 'self_model'];
    const curves: PathwayCurve[] = [];
    for (const type of types) {
      const typeNodes = newNodes.filter((n) => n.type === type);
      if (typeNodes.length < 2) continue;
      const sorted = typeNodes.sort((a, b) => a.x - b.x);
      const points = sorted.map((n) => ({ x: n.x, y: n.y }));
      curves.push({ type, points });
    }
    curvesRef.current = curves;

    // Generate river particles
    const newParticles: RiverParticle[] = [];
    for (let ci = 0; ci < curves.length; ci++) {
      const count = Math.min(curves[ci].points.length * 3, 15);
      for (let i = 0; i < count; i++) {
        newParticles.push({
          curveIndex: ci,
          t: Math.random(),
          speed: 0.001 + Math.random() * 0.002,
          size: 1 + Math.random() * 1.5,
          type: curves[ci].type,
        });
      }
    }
    particlesRef.current = newParticles;
  }, [memories, typeFilter, getClusterCenter]);

  // Main animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    let w = 0, h = 0;
    let frame: number;
    let fireTimer: ReturnType<typeof setInterval>;

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

    // Periodic firing
    fireTimer = setInterval(() => {
      const nodes = nodesRef.current;
      if (nodes.length === 0) return;
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      n.fireLevel = 1;
    }, 800);

    function evaluatePointOnCurve(points: { x: number; y: number }[], t: number) {
      if (points.length < 2) return points[0] || { x: 0, y: 0 };
      const totalSegments = points.length - 1;
      const segment = Math.min(Math.floor(t * totalSegments), totalSegments - 1);
      const localT = (t * totalSegments) - segment;
      const p0 = points[segment];
      const p1 = points[segment + 1];
      // Quadratic interpolation with mid-control point
      const mx = (p0.x + p1.x) / 2 + (Math.random() - 0.5) * 0.2;
      const my = (p0.y + p1.y) / 2 + (Math.random() - 0.5) * 0.2;
      const it = 1 - localT;
      return {
        x: it * it * p0.x + 2 * it * localT * mx + localT * localT * p1.x,
        y: it * it * p0.y + 2 * it * localT * my + localT * localT * p1.y,
      };
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);

      // Background
      const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
      bgGrad.addColorStop(0, '#0e0e18');
      bgGrad.addColorStop(1, '#0a0a0f');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle grid
      ctx.strokeStyle = 'rgba(255,255,255,0.015)';
      ctx.lineWidth = 0.5;
      const gridSize = 40;
      for (let gx = 0; gx < w; gx += gridSize) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      const nodes = nodesRef.current;
      const particles = particlesRef.current;
      const curves = curvesRef.current;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // Physics: force-directed layout
      for (const node of nodes) {
        // Home attraction
        const dhx = node.homeX - node.x;
        const dhy = node.homeY - node.y;
        node.vx += dhx * 0.003;
        node.vy += dhy * 0.003;

        // Repulsion from other nodes
        for (const other of nodes) {
          if (other.id === node.id) continue;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist < 60) {
            const force = (60 - dist) / dist * 0.15;
            node.vx += dx * force;
            node.vy += dy * force;
          }
        }

        // Damping
        node.vx *= 0.92;
        node.vy *= 0.92;
        node.x += node.vx;
        node.y += node.vy;

        // Bounds
        node.x = Math.max(20, Math.min(w - 20, node.x));
        node.y = Math.max(20, Math.min(h - 20, node.y));

        // Phase
        node.phase += 0.02;

        // Spawn decay
        if (node.spawning > 0) node.spawning *= 0.97;
        if (node.spawning < 0.01) node.spawning = 0;

        // Fire decay
        if (node.fireLevel > 0) {
          node.fireLevel *= 0.96;
          if (node.fireLevel < 0.01) node.fireLevel = 0;
        }
      }

      // Update pathway curves with current node positions
      for (let ci = 0; ci < curves.length; ci++) {
        const typeNodes = nodes.filter((n) => n.type === curves[ci].type);
        if (typeNodes.length >= 2) {
          const sorted = typeNodes.sort((a, b) => a.x - b.x);
          curves[ci].points = sorted.map((n) => ({ x: n.x, y: n.y }));
        }
      }

      // Draw pathway curves
      for (const curve of curves) {
        if (curve.points.length < 2) continue;
        const c = TYPE_COLORS[curve.type];
        ctx.beginPath();
        ctx.moveTo(curve.points[0].x, curve.points[0].y);
        for (let i = 1; i < curve.points.length; i++) {
          const prev = curve.points[i - 1];
          const curr = curve.points[i];
          const cpx = (prev.x + curr.x) / 2;
          const cpy = (prev.y + curr.y) / 2;
          ctx.quadraticCurveTo(prev.x, prev.y, cpx, cpy);
        }
        const last = curve.points[curve.points.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},0.08)`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Draw connections between close nodes of same type
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          if (a.type !== b.type) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) {
            const c = TYPE_COLORS[a.type];
            const alpha = (1 - dist / 100) * 0.1;
            const boost = Math.max(a.fireLevel, b.fireLevel);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${alpha + boost * 0.3})`;
            ctx.lineWidth = 0.5 + boost * 2;
            ctx.stroke();

            // Fire propagation
            if (a.fireLevel > 0.1 && dist < 70) {
              b.fireLevel = Math.max(b.fireLevel, a.fireLevel * 0.3);
            }
            if (b.fireLevel > 0.1 && dist < 70) {
              a.fireLevel = Math.max(a.fireLevel, b.fireLevel * 0.3);
            }
          }
        }
      }

      // Draw river particles
      for (const p of particles) {
        p.t += p.speed;
        if (p.t > 1) p.t -= 1;
        const curve = curves[p.curveIndex];
        if (!curve || curve.points.length < 2) continue;
        const pos = evaluatePointOnCurve(curve.points, p.t);
        const c = TYPE_COLORS[p.type];
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},0.4)`;
        ctx.fill();
      }

      // Draw nodes
      let newHovered: number | null = null;
      for (const node of nodes) {
        const c = TYPE_COLORS[node.type];
        const breathe = 1 + 0.06 * Math.sin(node.phase);
        const spawnScale = node.spawning > 0 ? (1.3 - 0.3 * (1 - node.spawning)) : 1;
        const r = node.radius * breathe * spawnScale * (0.5 + node.decay * 0.5);
        const isHovered = hoveredRef.current === node.id;
        const isSelected = selectedMemoryId === node.id;

        // Distance to mouse
        const dmx = mx - node.x, dmy = my - node.y;
        const dMouse = Math.sqrt(dmx * dmx + dmy * dmy);
        if (dMouse < r + 8) {
          newHovered = node.id;
        }

        // Outer glow
        if (node.fireLevel > 0.05 || isHovered || isSelected) {
          const glowR = r * (3 + node.fireLevel * 4);
          const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowR);
          const alpha = isHovered ? 0.25 : isSelected ? 0.2 : node.fireLevel * 0.15;
          glow.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${alpha})`);
          glow.addColorStop(1, 'transparent');
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        // Spawn burst particles
        if (node.spawning > 0.3) {
          const burstCount = 6;
          for (let bi = 0; bi < burstCount; bi++) {
            const angle = (bi / burstCount) * Math.PI * 2;
            const dist = r * 2 + (1 - node.spawning) * 20;
            const bx = node.x + Math.cos(angle) * dist;
            const by = node.y + Math.sin(angle) * dist;
            ctx.beginPath();
            ctx.arc(bx, by, 1, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${node.spawning * 0.5})`;
            ctx.fill();
          }
        }

        // Node body
        const nodeAlpha = 0.4 + node.decay * 0.6;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${nodeAlpha})`;
        ctx.fill();

        // Inner bright core
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${nodeAlpha + 0.3})`;
        ctx.fill();

        // Selected ring
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},0.6)`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      hoveredRef.current = newHovered;

      // Tooltip
      if (newHovered !== null) {
        const node = nodes.find((n) => n.id === newHovered);
        if (node) {
          setTooltip({ x: node.x, y: node.y - node.radius - 16, text: node.summary.slice(0, 80) });
        }
      } else {
        setTooltip(null);
      }

      frame = requestAnimationFrame(draw);
    }

    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(fireTimer);
      window.removeEventListener('resize', resize);
    };
  }, [selectedMemoryId]);

  // Mouse handlers
  function handleMouseMove(e: React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handleClick() {
    const hovered = hoveredRef.current;
    if (hovered !== null && onSelectMemory) {
      const mem = memories.find((m) => m.id === hovered);
      onSelectMemory(mem || null);
    } else if (onSelectMemory) {
      onSelectMemory(null);
    }
  }

  // HUD stats
  const filtered = typeFilter
    ? memories.filter((m) => typeFilter.has(m.memory_type))
    : memories;
  const typeCounts: Partial<Record<MemoryType, number>> = {};
  let totalDecay = 0;
  for (const m of filtered) {
    typeCounts[m.memory_type] = (typeCounts[m.memory_type] || 0) + 1;
    totalDecay += m.decay_factor;
  }
  const avgDecay = filtered.length > 0 ? totalDecay / filtered.length : 0;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0a0f' }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: hoveredRef.current !== null ? 'pointer' : 'default',
        }}
      />

      {/* HUD: Top-left stats */}
      <div style={{
        position: 'absolute',
        top: 16,
        left: 16,
        pointerEvents: 'none',
      }}>
        <div style={{
          fontSize: 10,
          letterSpacing: 2,
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.3)',
          marginBottom: 8,
        }}>
          Neural Map
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', marginBottom: 4 }}>
          {filtered.length}
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
          memories loaded
        </div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', marginTop: 8 }}>
          avg strength: {(avgDecay * 100).toFixed(0)}%
        </div>
      </div>

      {/* HUD: Top-right legend */}
      <div style={{
        position: 'absolute',
        top: 16,
        right: 16,
        pointerEvents: 'none',
      }}>
        {(Object.entries(TYPE_LABELS) as [MemoryType, string][]).map(([type, label]) => (
          <div key={type} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 6,
          }}>
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: TYPE_COLORS[type].hex,
              boxShadow: `0 0 4px ${TYPE_COLORS[type].hex}40`,
            }} />
            <span style={{
              fontSize: 9,
              letterSpacing: 1,
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.35)',
            }}>
              {label} ({typeCounts[type] || 0})
            </span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'absolute',
          left: tooltip.x,
          top: tooltip.y,
          transform: 'translate(-50%, -100%)',
          background: 'rgba(10,10,15,0.92)',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '6px 10px',
          fontSize: 11,
          color: 'rgba(255,255,255,0.7)',
          pointerEvents: 'none',
          maxWidth: 250,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
