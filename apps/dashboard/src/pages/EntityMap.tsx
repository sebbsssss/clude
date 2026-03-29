import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { useAuthContext } from '../hooks/AuthContext';
import { useAgentContext } from '../context/AgentContext';
import type { KnowledgeGraph } from '../types/memory';

const ENTITY_COLORS: Record<string, { color: string; label: string }> = {
  person:   { color: '#2244ff', label: 'Person' },
  project:  { color: '#10b981', label: 'Project' },
  concept:  { color: '#8b5cf6', label: 'Concept' },
  token:    { color: '#f59e0b', label: 'Token' },
  wallet:   { color: '#ef4444', label: 'Wallet' },
  location: { color: '#06b6d4', label: 'Location' },
  event:    { color: '#ec4899', label: 'Event' },
};

interface LayoutNode {
  id: string;
  type: string;
  label: string;
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  // Animation state
  spawnTime: number;
  opacity: number;
  scale: number;
}

// Easing functions
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutElastic(t: number): number {
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : { r: 100, g: 100, b: 100 };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const SECTION_HEADER: React.CSSProperties = {
  fontSize: 8, letterSpacing: 3, textTransform: 'uppercase',
  color: 'var(--text-faint)', fontWeight: 700,
};

// Constellation loading animation
function ConstellationLoader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    const w = 400;
    const h = 300;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Generate random dots
    const dots = Array.from({ length: 24 }, () => ({
      x: w * 0.2 + Math.random() * w * 0.6,
      y: h * 0.2 + Math.random() * h * 0.6,
      baseX: 0,
      baseY: 0,
      phase: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.7,
      radius: 1.5 + Math.random() * 2,
      color: Object.values(ENTITY_COLORS)[Math.floor(Math.random() * 7)].color,
    }));
    dots.forEach(d => { d.baseX = d.x; d.baseY = d.y; });

    let t = 0;
    function draw() {
      t += 0.016;
      ctx.clearRect(0, 0, w, h);

      // Move dots gently
      for (const d of dots) {
        d.x = d.baseX + Math.sin(t * d.speed + d.phase) * 8;
        d.y = d.baseY + Math.cos(t * d.speed * 0.7 + d.phase) * 6;
      }

      // Draw connecting lines
      for (let i = 0; i < dots.length; i++) {
        for (let j = i + 1; j < dots.length; j++) {
          const dx = dots[j].x - dots[i].x;
          const dy = dots[j].y - dots[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 90) {
            const alpha = (1 - dist / 90) * 0.12;
            ctx.beginPath();
            ctx.moveTo(dots[i].x, dots[i].y);
            ctx.lineTo(dots[j].x, dots[j].y);
            ctx.strokeStyle = `rgba(34, 68, 255, ${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Draw dots
      for (const d of dots) {
        const pulse = 0.7 + Math.sin(t * 2 + d.phase) * 0.3;
        const rgb = hexToRgb(d.color);

        // Glow
        const glow = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.radius * 6);
        glow.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.15 * pulse})`);
        glow.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.radius * 6, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Dot
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.radius * pulse, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.6 * pulse})`;
        ctx.fill();
      }

      // Loading text
      const dotCount = Math.floor(t * 2) % 4;
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.letterSpacing = '2px';
      ctx.fillText('MAPPING ENTITIES' + '.'.repeat(dotCount), w / 2, h - 30);

      animRef.current = requestAnimationFrame(draw);
    }
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div style={{
      height: 560, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <canvas ref={canvasRef} style={{ width: 400, height: 300 }} />
    </div>
  );
}

export function EntityMap() {
  const { authMode } = useAuthContext();
  const { selectedAgent } = useAgentContext();
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [graphStats, setGraphStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [includeMemories, setIncludeMemories] = useState(false);
  const [selectedNode, setSelectedNode] = useState<LayoutNode | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'graph' | 'table'>('graph');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<LayoutNode[]>([]);
  const animFrameRef = useRef<number>(0);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const hoveredRef = useRef<LayoutNode | null>(null);
  const hoverAmountRef = useRef<Map<string, number>>(new Map());
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    function load() {
      if (authMode === 'cortex') {
        setLoading(false);
        return;
      }
      setLoading(true);
      Promise.all([
        api.getKnowledgeGraph({ includeMemories, minMentions: 1 }),
        api.getGraphStats(),
      ]).then(([g, s]) => {
        setGraph(g);
        setGraphStats(s);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
    load();
    const unsubscribe = api.onRefresh(() => {
      setGraph(null);
      setGraphStats(null);
      load();
    });
    return () => { unsubscribe(); };
  }, [includeMemories, authMode]);

  // Track selected node ref for canvas drawing without re-initializing
  const selectedNodeRef = useRef<LayoutNode | null>(null);
  useEffect(() => { selectedNodeRef.current = selectedNode; }, [selectedNode]);

  const setSelectedNodeCb = useCallback((n: LayoutNode | null) => setSelectedNode(n), []);

  // ── Force-directed graph on canvas ──
  useEffect(() => {
    if (!graph || !canvasRef.current || viewMode !== 'graph') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const dpr = window.devicePixelRatio || 1;
    startTimeRef.current = performance.now();
    hoverAmountRef.current = new Map();

    function resize() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;

    // Initialize nodes with type-clustered positions
    const typeAngles: Record<string, number> = {};
    const typeKeys = [...new Set(graph.nodes.map(n => n.type))];
    typeKeys.forEach((t, i) => { typeAngles[t] = (i / typeKeys.length) * Math.PI * 2; });

    const now = performance.now();
    const nodes: LayoutNode[] = graph.nodes.map((n, idx) => {
      const angle = typeAngles[n.type] || 0;
      const spread = Math.min(w, h) * 0.25;
      return {
        ...n,
        x: w / 2 + Math.cos(angle) * spread + (Math.random() - 0.5) * spread * 0.6,
        y: h / 2 + Math.sin(angle) * spread + (Math.random() - 0.5) * spread * 0.6,
        vx: 0, vy: 0, fx: 0, fy: 0,
        spawnTime: now + idx * 20, // staggered spawn
        opacity: 0,
        scale: 0,
      };
    });

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    nodesRef.current = nodes;

    // Build adjacency for hover highlighting
    const adjacency = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
      if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
      adjacency.get(edge.source)!.add(edge.target);
      adjacency.get(edge.target)!.add(edge.source);
    }

    let iteration = 0;
    const settling = 300;

    // ── Grid background (cached to offscreen canvas) ──
    const gridCanvas = document.createElement('canvas');
    const gridCtx = gridCanvas.getContext('2d')!;
    function renderGrid(gw: number, gh: number) {
      gridCanvas.width = gw * dpr;
      gridCanvas.height = gh * dpr;
      gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Base fill
      const bgGrad = gridCtx.createRadialGradient(gw / 2, gh / 2, 0, gw / 2, gh / 2, gw * 0.7);
      bgGrad.addColorStop(0, '#fafaf6');
      bgGrad.addColorStop(1, '#f5f5f0');
      gridCtx.fillStyle = bgGrad;
      gridCtx.fillRect(0, 0, gw, gh);

      // Dot grid
      const spacing = 28;
      for (let x = spacing; x < gw; x += spacing) {
        for (let y = spacing; y < gh; y += spacing) {
          // Fade dots toward edges
          const edgeFadeX = Math.min(x, gw - x) / 80;
          const edgeFadeY = Math.min(y, gh - y) / 80;
          const edgeFade = Math.min(1, Math.min(edgeFadeX, edgeFadeY));
          const alpha = 0.06 * edgeFade;
          gridCtx.beginPath();
          gridCtx.arc(x, y, 0.6, 0, Math.PI * 2);
          gridCtx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
          gridCtx.fill();
        }
      }
    }
    renderGrid(w, h);

    function tick() {
      const currentTime = performance.now();
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const alpha = iteration < settling ? 1 - iteration / settling : 0;
      const cooling = 0.3 + alpha * 0.7;

      // Update node spawn animations
      for (const node of nodes) {
        const elapsed = (currentTime - node.spawnTime) / 600; // 600ms spawn
        if (elapsed < 0) {
          node.opacity = 0;
          node.scale = 0;
        } else if (elapsed < 1) {
          node.opacity = easeOutCubic(elapsed);
          node.scale = easeOutElastic(elapsed);
        } else {
          node.opacity = 1;
          node.scale = 1;
        }
      }

      if (alpha > 0.01) {
        // Repulsion
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const force = (600 * cooling) / (dist * dist);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            nodes[i].fx -= fx; nodes[i].fy -= fy;
            nodes[j].fx += fx; nodes[j].fy += fy;
          }
        }

        // Edge attraction
        for (const edge of graph!.edges) {
          const s = nodeMap.get(edge.source);
          const t = nodeMap.get(edge.target);
          if (!s || !t) continue;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = dist * 0.004 * (edge.weight || 0.5) * cooling;
          s.fx += (dx / dist) * force; s.fy += (dy / dist) * force;
          t.fx -= (dx / dist) * force; t.fy -= (dy / dist) * force;
        }

        // Center gravity
        for (const n of nodes) {
          n.fx += (w / 2 - n.x) * 0.0008 * cooling;
          n.fy += (h / 2 - n.y) * 0.0008 * cooling;
        }

        // Integrate
        const damping = 0.82;
        for (const n of nodes) {
          n.vx = (n.vx + n.fx) * damping;
          n.vy = (n.vy + n.fy) * damping;
          n.x += n.vx; n.y += n.vy;
          n.x = Math.max(30, Math.min(w - 30, n.x));
          n.y = Math.max(30, Math.min(h - 30, n.y));
          n.fx = 0; n.fy = 0;
        }
      }

      // ── Draw ──
      // Grid background
      ctx.drawImage(gridCanvas, 0, 0, w, h);

      // Mouse tracking for hover
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      let closest: LayoutNode | null = null;
      let closestDist = Infinity;
      for (const n of nodes) {
        if (n.opacity < 0.1) continue;
        const dx = mx - n.x, dy = my - n.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitR = Math.max(8, n.size / 2) + 8;
        if (dist < hitR && dist < closestDist) {
          closest = n;
          closestDist = dist;
        }
      }

      const hovered = closest;
      hoveredRef.current = hovered;
      const hoveredNeighbors = hovered ? adjacency.get(hovered.id) : null;
      const isHighlightMode = !!hovered;

      // Smooth hover amounts
      for (const node of nodes) {
        const isHov = hovered?.id === node.id;
        const isNeighbor = hoveredNeighbors?.has(node.id);
        const target = isHov ? 1.0 : isNeighbor ? 0.6 : 0;
        const current = hoverAmountRef.current.get(node.id) || 0;
        const speed = 0.12;
        const next = lerp(current, target, speed);
        hoverAmountRef.current.set(node.id, next);
      }

      // Time for pulsing
      const time = currentTime * 0.001;

      // ── Edges ──
      for (const edge of graph!.edges) {
        const s = nodeMap.get(edge.source);
        const t = nodeMap.get(edge.target);
        if (!s || !t) continue;
        if (s.opacity < 0.05 || t.opacity < 0.05) continue;

        const isConnected = hovered && (
          edge.source === hovered.id || edge.target === hovered.id
        );

        const edgeOpacityFinal = Math.min(s.opacity, t.opacity);

        // Neural network style: prominent dendrite-like edges
        const baseAlpha = isHighlightMode
          ? (isConnected ? 0.5 : 0.03)
          : 0.08 + (edge.weight || 0.5) * 0.12;

        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const curvature = Math.min(0.12, 20 / (dist + 1));
        const midX = (s.x + t.x) / 2 + (s.y - t.y) * curvature;
        const midY = (s.y + t.y) / 2 + (t.x - s.x) * curvature;

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(midX, midY, t.x, t.y);

        const sRgb = hexToRgb(ENTITY_COLORS[s.type]?.color || '#666');
        const tRgb = hexToRgb(ENTITY_COLORS[t.type]?.color || '#666');
        const grad = ctx.createLinearGradient(s.x, s.y, t.x, t.y);
        const alpha = baseAlpha * edgeOpacityFinal;
        grad.addColorStop(0, `rgba(${sRgb.r}, ${sRgb.g}, ${sRgb.b}, ${alpha})`);
        grad.addColorStop(1, `rgba(${tRgb.r}, ${tRgb.g}, ${tRgb.b}, ${alpha})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = isConnected ? 1.5 : 0.7;
        ctx.stroke();

        // Traveling signal pulse along edge (neural firing effect)
        if (isConnected || Math.random() < 0.002) {
          const signalT = (time * 0.5 + dist * 0.001) % 1;
          // Simplified: interpolate along the curve
          const pt = signalT;
          const px = (1-pt)*(1-pt)*s.x + 2*(1-pt)*pt*midX + pt*pt*t.x;
          const py = (1-pt)*(1-pt)*s.y + 2*(1-pt)*pt*midY + pt*pt*t.y;
          const signalGlow = ctx.createRadialGradient(px, py, 0, px, py, 4);
          const avgR = (sRgb.r + tRgb.r) >> 1;
          const avgG = (sRgb.g + tRgb.g) >> 1;
          const avgB = (sRgb.b + tRgb.b) >> 1;
          signalGlow.addColorStop(0, `rgba(${avgR}, ${avgG}, ${avgB}, ${0.6 * edgeOpacityFinal})`);
          signalGlow.addColorStop(1, `rgba(${avgR}, ${avgG}, ${avgB}, 0)`);
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fillStyle = signalGlow;
          ctx.fill();
        }
      }

      // ── Nodes ──
      for (const node of nodes) {
        if (node.opacity < 0.01) continue;

        const ec = ENTITY_COLORS[node.type] || { color: '#6b7280', label: node.type };
        const rgb = hexToRgb(ec.color);
        const baseRadius = Math.max(2, Math.min(6, 1.5 + node.size / 4));
        const hoverAmt = hoverAmountRef.current.get(node.id) || 0;
        const isSelected = selectedNodeRef.current?.id === node.id;

        // Pulsing based on mention count (higher = faster pulse)
        const pulseSpeed = 0.8 + Math.min(node.size / 20, 1.5);
        const pulseAmt = 0.04 + Math.min(node.size / 60, 0.12);
        const pulse = 1 + Math.sin(time * pulseSpeed + node.x * 0.01) * pulseAmt;

        // Final radius with spawn, hover, and pulse
        const hoverExpand = 1 + hoverAmt * 0.5;
        const radius = baseRadius * node.scale * pulse * hoverExpand;
        const nodeAlpha = node.opacity;

        // Dimming in highlight mode
        const dimFactor = isHighlightMode ? (hoverAmt > 0.05 ? 1 : 0.15) : 1;

        // Subtle soma glow (not bubbly — tight and neural)
        const glowRadius = radius * (1.8 + hoverAmt * 1.5);
        const glowAlpha = (0.12 + hoverAmt * 0.25) * nodeAlpha * dimFactor;
        const glow = ctx.createRadialGradient(node.x, node.y, radius * 0.5, node.x, node.y, glowRadius);
        glow.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowAlpha})`);
        glow.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`);
        ctx.beginPath();
        ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();

        // Selection ring (animated rotation)
        if (isSelected) {
          const ringR = radius + 5 + Math.sin(time * 1.5) * 1;
          ctx.beginPath();
          ctx.arc(node.x, node.y, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.3 * nodeAlpha})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.lineDashOffset = -time * 12;
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
        }

        // Node body — solid colored dot
        const mainAlpha = (0.8 + hoverAmt * 0.2) * nodeAlpha * dimFactor;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${mainAlpha})`;
        ctx.fill();

        // Bright core (neuron soma center)
        if (dimFactor > 0.3) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius * 0.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${0.6 * nodeAlpha * dimFactor})`;
          ctx.fill();
        }

        // Labels
        const showLabel = node.size > 6 || hoverAmt > 0.2;
        if (showLabel) {
          const labelAlpha = node.size > 6
            ? (0.5 + hoverAmt * 0.5) * nodeAlpha * dimFactor
            : hoverAmt * nodeAlpha * dimFactor;
          if (labelAlpha > 0.02) {
            const fontSize = lerp(9, 11.5, hoverAmt);
            const weight = hoverAmt > 0.4 ? '600' : '400';
            ctx.font = `${weight} ${fontSize}px "JetBrains Mono", monospace`;
            ctx.fillStyle = `rgba(17, 17, 17, ${labelAlpha})`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const label = node.label.length > 20 ? node.label.slice(0, 18) + '..' : node.label;

            // Text shadow for readability
            ctx.save();
            ctx.shadowColor = `rgba(245, 245, 240, ${labelAlpha})`;
            ctx.shadowBlur = 4;
            ctx.fillText(label, node.x, node.y + radius + 6);
            ctx.restore();
          }
        }
      }

      // ── Hover tooltip ──
      if (hovered && hovered.opacity > 0.5) {
        const ec = ENTITY_COLORS[hovered.type] || { color: '#666', label: hovered.type };
        const hRgb = hexToRgb(ec.color);
        const neighborCount = hoveredNeighbors?.size || 0;
        const tooltipX = hovered.x;
        const baseR = Math.max(3.5, hovered.size / 2.2);
        const tooltipY = hovered.y - baseR * 2 - 22;
        const text = `${hovered.label}  ·  ${ec.label}  ·  ${neighborCount} conn`;
        ctx.font = '500 9px "JetBrains Mono", monospace';
        const tw = ctx.measureText(text).width + 20;
        const th = 24;

        const rx = tooltipX - tw / 2, ry = tooltipY - th / 2;

        // Glass tooltip
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 4;
        ctx.beginPath();
        ctx.roundRect(rx, ry, tw, th, 4);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.fill();
        ctx.restore();

        // Colored top accent line
        ctx.beginPath();
        ctx.roundRect(rx, ry, tw, 2, [4, 4, 0, 0]);
        ctx.fillStyle = `rgba(${hRgb.r}, ${hRgb.g}, ${hRgb.b}, 0.6)`;
        ctx.fill();

        // Border
        ctx.beginPath();
        ctx.roundRect(rx, ry, tw, th, 4);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        // Text
        ctx.fillStyle = '#111';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tooltipX, tooltipY + 2);
      }

      // ── Bottom legend bar ──
      const legendY = h - 36;
      // Glass bar background
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fillRect(0, legendY - 4, w, 40);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
      ctx.fillRect(0, legendY - 4, w, 0.5);

      const legendTypes = Object.entries(ENTITY_COLORS);
      const totalLegendW = legendTypes.length * 80;
      const legendStartX = (w - totalLegendW) / 2;

      legendTypes.forEach(([, ec], idx) => {
        const lx = legendStartX + idx * 80;
        const ly = legendY + 10;
        const lRgb = hexToRgb(ec.color);

        // Dot with glow
        const dotGlow = ctx.createRadialGradient(lx + 6, ly, 0, lx + 6, ly, 8);
        dotGlow.addColorStop(0, `rgba(${lRgb.r}, ${lRgb.g}, ${lRgb.b}, 0.2)`);
        dotGlow.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(lx + 6, ly, 8, 0, Math.PI * 2);
        ctx.fillStyle = dotGlow;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(lx + 6, ly, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${lRgb.r}, ${lRgb.g}, ${lRgb.b}, 0.85)`;
        ctx.fill();

        // Label
        ctx.font = '400 8px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ec.label, lx + 14, ly);
      });

      iteration++;
      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);

    // Mouse handlers
    function handleMouseMove(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      canvas.style.cursor = hoveredRef.current ? 'pointer' : 'default';
    }
    function handleMouseLeave() {
      mouseRef.current = { x: -9999, y: -9999 };
      canvas.style.cursor = 'default';
    }
    function handleClick(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (const n of nodesRef.current) {
        if (n.opacity < 0.1) continue;
        const dx = n.x - x, dy = n.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < Math.max(8, n.size / 2) + 8) {
          setSelectedNodeCb(n);
          return;
        }
      }
      setSelectedNodeCb(null);
    }

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('click', handleClick);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('click', handleClick);
    };
  }, [graph, viewMode, setSelectedNodeCb]);

  // ── Filter entities for table ──
  const filteredEntities = graphStats?.topEntities?.filter((e: any) =>
    !searchQuery || e.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  // ── Stats summary ──
  const totalNodes = graph?.nodes.length || 0;
  const totalEdges = graph?.edges.length || 0;
  const typeBreakdown = graph?.nodes.reduce((acc, n) => {
    acc[n.type] = (acc[n.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ ...SECTION_HEADER, marginBottom: 10 }}>Knowledge Graph</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <h1 style={{
            fontSize: 28, fontWeight: 800, letterSpacing: -1, margin: 0,
          }}>
            Entity Map
          </h1>
          <span style={{ fontSize: 12, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
            {totalNodes} entities · {totalEdges} relations
          </span>
        </div>
      </div>

      {authMode === 'cortex' && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 3,
          padding: '48px 24px', textAlign: 'center',
          color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.8,
          background: 'var(--bg-card)',
        }}>
          <div style={{ fontSize: 32, opacity: 0.15, marginBottom: 16 }}>&#9678;</div>
          Entity graph requires self-hosted mode.<br />
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            Set up your own Supabase instance to use the knowledge graph.
          </span>
        </div>
      )}

      {authMode !== 'cortex' && <>

        {/* Agent awareness notice */}
        {selectedAgent && (
          <div style={{
            padding: '8px 14px',
            marginBottom: 12,
            background: 'rgba(34, 68, 255, 0.04)',
            border: '1px solid rgba(34, 68, 255, 0.08)',
            borderRadius: 2,
            fontSize: 10,
            color: 'var(--text-muted)',
            letterSpacing: 0.3,
          }}>
            Entity map shows data across all agents. Agent filtering is not applied here.
          </div>
        )}

        {/* ── Controls Bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: 16, flexWrap: 'wrap',
        }}>
          {/* View toggle */}
          <div style={{
            display: 'flex', border: '1px solid var(--border)', borderRadius: 3,
            overflow: 'hidden',
          }}>
            {(['graph', 'table'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: '6px 16px', fontSize: 9,
                  letterSpacing: 1.5, textTransform: 'uppercase',
                  border: 'none',
                  background: viewMode === mode ? 'var(--text)' : 'transparent',
                  color: viewMode === mode ? 'var(--bg)' : 'var(--text-muted)',
                  fontFamily: 'var(--mono)',
                  fontWeight: viewMode === mode ? 700 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                {mode}
              </button>
            ))}
          </div>

          <label style={{
            fontSize: 10, color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', gap: 6,
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={includeMemories}
              onChange={(e) => setIncludeMemories(e.target.checked)}
              style={{ accentColor: '#2244ff' }}
            />
            Include memories
          </label>

          {viewMode === 'table' && (
            <input
              type="text"
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                padding: '6px 14px', fontSize: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text)',
                fontFamily: 'var(--mono)',
                outline: 'none',
                width: 200,
                borderRadius: 3,
                transition: 'border-color 0.2s ease',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(34, 68, 255, 0.3)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            />
          )}

          {/* Compact stats */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {Object.entries(typeBreakdown).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
              const ec = ENTITY_COLORS[type] || { color: '#6b7280', label: type };
              return (
                <div key={type} style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px',
                  background: 'rgba(255,255,255,0.6)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  fontSize: 9,
                  letterSpacing: 0.3,
                  backdropFilter: 'blur(4px)',
                }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: '50%',
                    background: ec.color,
                    boxShadow: `0 0 4px ${ec.color}40`,
                  }} />
                  <span style={{ color: 'var(--text-faint)' }}>{ec.label}</span>
                  <span style={{
                    color: ec.color, fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Graph View ── */}
        {viewMode === 'graph' && (
          <div style={{
            border: '1px solid var(--border)', borderRadius: 4,
            position: 'relative', background: '#f5f5f0', overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03), 0 8px 24px rgba(0,0,0,0.02)',
          }}>
            {loading ? (
              <ConstellationLoader />
            ) : (
              <canvas
                ref={canvasRef}
                style={{
                  width: '100%', height: 560, display: 'block',
                  cursor: 'default',
                }}
              />
            )}

            {/* ── Selected node glassmorphism panel ── */}
            {selectedNode && (
              <div style={{
                position: 'absolute', top: 16, right: 16,
                background: 'rgba(255, 255, 255, 0.72)',
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                borderRadius: 8,
                padding: '20px 22px 24px', width: 240,
                boxShadow: '0 4px 24px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
                animation: 'panelSlideIn 0.3s ease-out',
              }}>
                {/* Colored accent stripe */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                  borderRadius: '8px 8px 0 0',
                  background: `linear-gradient(90deg, ${ENTITY_COLORS[selectedNode.type]?.color || '#666'}, ${ENTITY_COLORS[selectedNode.type]?.color || '#666'}66)`,
                }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, marginTop: 4, minWidth: 0 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: ENTITY_COLORS[selectedNode.type]?.color || '#666',
                    boxShadow: `0 0 8px ${ENTITY_COLORS[selectedNode.type]?.color || '#666'}50`,
                  }} />
                  <span style={{
                    fontWeight: 700, fontSize: 14, letterSpacing: -0.3,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {selectedNode.label}
                  </span>
                </div>

                <div style={{
                  fontSize: 8, letterSpacing: 2.5, textTransform: 'uppercase',
                  color: ENTITY_COLORS[selectedNode.type]?.color || '#666',
                  fontWeight: 700, marginBottom: 14,
                  opacity: 0.8,
                }}>
                  {ENTITY_COLORS[selectedNode.type]?.label || selectedNode.type}
                </div>

                <div style={{
                  display: 'flex', gap: 20, fontSize: 10,
                  color: 'var(--text-faint)',
                  paddingTop: 14,
                  borderTop: '1px solid rgba(0, 0, 0, 0.05)',
                }}>
                  <div>
                    <div style={{
                      fontWeight: 800, color: 'var(--text)', fontSize: 18,
                      fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5,
                    }}>
                      {selectedNode.size}
                    </div>
                    <div style={{
                      fontSize: 8, letterSpacing: 1.5, textTransform: 'uppercase',
                      marginTop: 3, opacity: 0.5,
                    }}>
                      Mentions
                    </div>
                  </div>
                  <div>
                    <div style={{
                      fontWeight: 800, color: 'var(--text)', fontSize: 18,
                      fontVariantNumeric: 'tabular-nums', letterSpacing: -0.5,
                    }}>
                      {graph?.edges.filter(e =>
                        e.source === selectedNode!.id || e.target === selectedNode!.id
                      ).length || 0}
                    </div>
                    <div style={{
                      fontSize: 8, letterSpacing: 1.5, textTransform: 'uppercase',
                      marginTop: 3, opacity: 0.5,
                    }}>
                      Relations
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedNode(null)}
                  style={{
                    position: 'absolute', top: 10, right: 10,
                    background: 'rgba(0, 0, 0, 0.04)', border: 'none',
                    color: 'var(--text-faint)', cursor: 'pointer',
                    fontSize: 13, fontFamily: 'var(--mono)',
                    padding: '2px 7px',
                    borderRadius: 4,
                    transition: 'background 0.15s ease',
                    lineHeight: '18px',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.08)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                >
                  &times;
                </button>
              </div>
            )}

            {/* Inject panel animation keyframes */}
            <style>{`
              @keyframes panelSlideIn {
                from { opacity: 0; transform: translateY(-8px) scale(0.97); }
                to { opacity: 1; transform: translateY(0) scale(1); }
              }
            `}</style>
          </div>
        )}

        {/* ── Table View ── */}
        {viewMode === 'table' && (
          <div style={{
            border: '1px solid var(--border)', borderRadius: 4,
            background: 'var(--bg-card)', overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '28px 1fr 100px 80px 80px',
              padding: '12px 20px',
              borderBottom: '1px solid var(--border)',
              fontSize: 8, letterSpacing: 2.5, textTransform: 'uppercase',
              color: 'var(--text-faint)', fontWeight: 700,
              alignItems: 'center',
              background: 'rgba(0, 0, 0, 0.01)',
            }}>
              <span />
              <span>Entity</span>
              <span>Type</span>
              <span style={{ textAlign: 'right' }}>Mentions</span>
              <span style={{ textAlign: 'right' }}>Strength</span>
            </div>

            {/* Table rows */}
            <div style={{ maxHeight: 480, overflow: 'auto' }}>
              {filteredEntities.length === 0 && (
                <div style={{
                  padding: '48px 20px', textAlign: 'center',
                  fontSize: 11, color: 'var(--text-faint)',
                }}>
                  {searchQuery ? 'No entities match your search' : 'No entities found'}
                </div>
              )}
              {filteredEntities.map((e: any, idx: number) => {
                const ec = ENTITY_COLORS[e.type] || { color: '#6b7280', label: e.type };
                const ecRgb = hexToRgb(ec.color);
                const maxMentions = filteredEntities[0]?.mentions || 1;
                const barPct = (e.mentions / maxMentions) * 100;
                return (
                  <div
                    key={e.name}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '28px 1fr 100px 80px 80px',
                      padding: '11px 20px',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 11,
                      alignItems: 'center',
                      transition: 'background 0.15s ease',
                      cursor: 'default',
                      animation: `tableRowIn 0.3s ease-out ${idx * 0.02}s both`,
                    }}
                    onMouseEnter={(ev) => {
                      ev.currentTarget.style.background = `rgba(${ecRgb.r}, ${ecRgb.g}, ${ecRgb.b}, 0.03)`;
                    }}
                    onMouseLeave={(ev) => {
                      ev.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: ec.color,
                      display: 'inline-block',
                      boxShadow: `0 0 5px ${ec.color}30`,
                    }} />
                    <span style={{
                      fontWeight: 600, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      letterSpacing: -0.2,
                    }}>
                      {e.name}
                    </span>
                    <span style={{
                      fontSize: 8, letterSpacing: 1.5, textTransform: 'uppercase',
                      color: ec.color, fontWeight: 600,
                    }}>
                      {ec.label}
                    </span>
                    <span style={{
                      textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                      color: 'var(--text-muted)', fontWeight: 600,
                    }}>
                      {e.mentions}
                    </span>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{
                        width: 48, height: 3, background: 'var(--border)',
                        borderRadius: 2, overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%', width: `${barPct}%`,
                          background: `linear-gradient(90deg, ${ec.color}88, ${ec.color})`,
                          borderRadius: 2,
                          transition: 'width 0.8s ease',
                        }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <style>{`
              @keyframes tableRowIn {
                from { opacity: 0; transform: translateY(4px); }
                to { opacity: 1; transform: translateY(0); }
              }
            `}</style>
          </div>
        )}
      </>}
    </div>
  );
}
