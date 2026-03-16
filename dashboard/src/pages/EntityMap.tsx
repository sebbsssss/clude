import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import { useAuthContext } from '../hooks/AuthContext';
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
}

const SECTION_HEADER: React.CSSProperties = {
  fontSize: 8, letterSpacing: 3, textTransform: 'uppercase',
  color: 'var(--text-faint)', fontWeight: 700,
};

export function EntityMap() {
  const { authMode } = useAuthContext();
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
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
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
  }, [includeMemories, authMode]);

  // ── Force-directed graph on canvas ──
  useEffect(() => {
    if (!graph || !canvasRef.current || viewMode !== 'graph') return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

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

    const nodes: LayoutNode[] = graph.nodes.map((n) => {
      const angle = typeAngles[n.type] || 0;
      const spread = Math.min(w, h) * 0.25;
      return {
        ...n,
        x: w / 2 + Math.cos(angle) * spread + (Math.random() - 0.5) * spread * 0.6,
        y: h / 2 + Math.sin(angle) * spread + (Math.random() - 0.5) * spread * 0.6,
        vx: 0, vy: 0, fx: 0, fy: 0,
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

    function tick() {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      const alpha = iteration < settling ? 1 - iteration / settling : 0;
      const cooling = 0.3 + alpha * 0.7;

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
      ctx.clearRect(0, 0, w, h);

      // Subtle radial bg gradient
      const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.6);
      bgGrad.addColorStop(0, '#f8f8f4');
      bgGrad.addColorStop(1, '#f5f5f0');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Mouse tracking for hover
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      let closest: LayoutNode | null = null;
      let closestDist = Infinity;
      for (const n of nodes) {
        const dx = mx - n.x, dy = my - n.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitR = Math.max(6, n.size / 2.5) + 6;
        if (dist < hitR && dist < closestDist) {
          closest = n;
          closestDist = dist;
        }
      }

      const hovered = closest;
      const hoveredNeighbors = hovered ? adjacency.get(hovered.id) : null;
      const isHighlightMode = !!hovered;

      // Edges
      for (const edge of graph!.edges) {
        const s = nodeMap.get(edge.source);
        const t = nodeMap.get(edge.target);
        if (!s || !t) continue;

        const isConnected = hovered && (
          edge.source === hovered.id || edge.target === hovered.id
        );

        const baseAlpha = isHighlightMode
          ? (isConnected ? 0.25 : 0.02)
          : 0.04 + (edge.weight || 0.5) * 0.06;

        ctx.beginPath();
        // Curved edges for visual interest
        const midX = (s.x + t.x) / 2 + (s.y - t.y) * 0.08;
        const midY = (s.y + t.y) / 2 + (t.x - s.x) * 0.08;
        ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(midX, midY, t.x, t.y);
        ctx.strokeStyle = isConnected
          ? (ENTITY_COLORS[s.type]?.color || '#666') + '50'
          : `rgba(0, 0, 0, ${baseAlpha})`;
        ctx.lineWidth = isConnected ? 1.5 : 0.8;
        ctx.stroke();
      }

      // Nodes
      for (const node of nodes) {
        const ec = ENTITY_COLORS[node.type] || { color: '#6b7280', label: node.type };
        const radius = Math.max(3, node.size / 2.5);
        const isHovered = hovered?.id === node.id;
        const isNeighbor = hoveredNeighbors?.has(node.id);
        const isSelected = selectedNode?.id === node.id;
        const dimmed = isHighlightMode && !isHovered && !isNeighbor;

        // Outer glow for hovered/selected
        if (isHovered || isSelected) {
          const glowR = radius * 4;
          const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowR);
          glow.addColorStop(0, ec.color + '20');
          glow.addColorStop(1, 'transparent');
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        // Node body
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = dimmed ? ec.color + '20' : ec.color + (isHovered ? 'ff' : 'cc');
        ctx.fill();

        // Inner highlight
        if (!dimmed) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius * 0.45, 0, Math.PI * 2);
          ctx.fillStyle = ec.color + (isHovered ? 'ff' : 'ee');
          ctx.fill();
        }

        // Selection ring
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
          ctx.strokeStyle = ec.color + '80';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Labels for larger or hovered nodes
        if (node.size > 6 || isHovered || isNeighbor) {
          ctx.font = `${isHovered ? '600' : '400'} ${isHovered ? 11 : 9}px "JetBrains Mono", monospace`;
          ctx.fillStyle = dimmed ? 'rgba(0,0,0,0.1)' : isHovered ? '#111' : 'rgba(0,0,0,0.45)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const label = node.label.length > 18 ? node.label.slice(0, 16) + '..' : node.label;
          ctx.fillText(label, node.x, node.y + radius + 5);
        }
      }

      // Hovered node tooltip
      if (hovered) {
        const ec = ENTITY_COLORS[hovered.type] || { color: '#666', label: hovered.type };
        const neighborCount = hoveredNeighbors?.size || 0;
        const tooltipX = hovered.x;
        const tooltipY = hovered.y - Math.max(6, hovered.size / 2.5) - 28;
        const text = `${hovered.label}  ·  ${ec.label}  ·  ${neighborCount} conn.`;
        ctx.font = '500 9px "JetBrains Mono", monospace';
        const tw = ctx.measureText(text).width + 16;

        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.lineWidth = 1;
        const rx = tooltipX - tw / 2, ry = tooltipY - 8;
        ctx.beginPath();
        ctx.roundRect(rx, ry, tw, 20, 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#111';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tooltipX, tooltipY + 2);
      }

      iteration++;
      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);

    // Mouse handlers
    function handleMouseMove(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    function handleClick(e: MouseEvent) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (const n of nodesRef.current) {
        const dx = n.x - x, dy = n.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < Math.max(8, n.size / 2.5) + 6) {
          setSelectedNode(n);
          return;
        }
      }
      setSelectedNode(null);
    }

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('click', handleClick);
    canvas.style.cursor = 'default';

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('click', handleClick);
    };
  }, [graph, viewMode, selectedNode]);

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
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
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
          <div style={{ fontSize: 32, opacity: 0.15, marginBottom: 16 }}>◎</div>
          Entity graph requires self-hosted mode.<br />
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            Set up your own Supabase instance to use the knowledge graph.
          </span>
        </div>
      )}

      {authMode !== 'cortex' && <>

        {/* ── Controls Bar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          marginBottom: 16, flexWrap: 'wrap',
        }}>
          {/* View toggle */}
          <div style={{
            display: 'flex', border: '1px solid var(--border)', borderRadius: 2,
            overflow: 'hidden',
          }}>
            {(['graph', 'table'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: '5px 14px', fontSize: 9,
                  letterSpacing: 1.5, textTransform: 'uppercase',
                  border: 'none',
                  background: viewMode === mode ? 'var(--text)' : 'transparent',
                  color: viewMode === mode ? 'var(--bg)' : 'var(--text-muted)',
                  fontFamily: 'var(--mono)',
                  fontWeight: viewMode === mode ? 700 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
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
                padding: '5px 12px', fontSize: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text)',
                fontFamily: 'var(--mono)',
                outline: 'none',
                width: 180,
                borderRadius: 2,
              }}
            />
          )}

          {/* Legend */}
          <div style={{
            display: 'flex', gap: 12, marginLeft: 'auto',
            flexWrap: 'wrap',
          }}>
            {Object.entries(ENTITY_COLORS).map(([type, ec]) => (
              <span key={type} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 9, color: 'var(--text-faint)',
                letterSpacing: 0.5,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: ec.color, display: 'inline-block',
                  boxShadow: `0 0 3px ${ec.color}30`,
                }} />
                {ec.label}
              </span>
            ))}
          </div>
        </div>

        {/* ── Type Summary Chips ── */}
        {totalNodes > 0 && (
          <div style={{
            display: 'flex', gap: 3, marginBottom: 16, flexWrap: 'wrap',
          }}>
            {Object.entries(typeBreakdown).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
              const ec = ENTITY_COLORS[type] || { color: '#6b7280', label: type };
              return (
                <div key={type} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 12px',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 2,
                  fontSize: 10,
                }}>
                  <span style={{
                    width: 3, height: 10, borderRadius: 1,
                    background: ec.color,
                  }} />
                  <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{ec.label}</span>
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
        )}

        {/* ── Graph View ── */}
        {viewMode === 'graph' && (
          <div style={{
            border: '1px solid var(--border)', borderRadius: 3,
            position: 'relative', background: 'var(--bg-card)', overflow: 'hidden',
          }}>
            {loading ? (
              <div style={{
                height: 560, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 12,
              }}>
                <div className="loading-shimmer" style={{
                  width: 120, height: 3, borderRadius: 2,
                }} />
                <span style={{
                  fontSize: 9, color: 'var(--text-faint)',
                  letterSpacing: 2, textTransform: 'uppercase',
                }}>
                  Mapping entities
                </span>
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                style={{
                  width: '100%', height: 560, display: 'block',
                  cursor: 'default',
                }}
              />
            )}

            {/* Selected node detail panel */}
            {selectedNode && (
              <div style={{
                position: 'absolute', top: 16, right: 16,
                background: 'rgba(255,255,255,0.96)',
                backdropFilter: 'blur(12px)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                padding: '16px 18px', width: 220,
                boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: ENTITY_COLORS[selectedNode.type]?.color || '#666',
                    boxShadow: `0 0 6px ${ENTITY_COLORS[selectedNode.type]?.color || '#666'}40`,
                  }} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    {selectedNode.label}
                  </span>
                </div>
                <div style={{
                  fontSize: 8, letterSpacing: 2, textTransform: 'uppercase',
                  color: ENTITY_COLORS[selectedNode.type]?.color || '#666',
                  fontWeight: 700, marginBottom: 10,
                }}>
                  {ENTITY_COLORS[selectedNode.type]?.label || selectedNode.type}
                </div>
                <div style={{
                  display: 'flex', gap: 16, fontSize: 10,
                  color: 'var(--text-faint)',
                  paddingTop: 10, borderTop: '1px solid var(--border)',
                }}>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>
                      {selectedNode.size}
                    </div>
                    <div style={{ fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>
                      Mentions
                    </div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>
                      {graph?.edges.filter(e =>
                        e.source === selectedNode!.id || e.target === selectedNode!.id
                      ).length || 0}
                    </div>
                    <div style={{ fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>
                      Relations
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  style={{
                    position: 'absolute', top: 8, right: 8,
                    background: 'none', border: 'none',
                    color: 'var(--text-faint)', cursor: 'pointer',
                    fontSize: 14, fontFamily: 'var(--mono)',
                    padding: '2px 6px',
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Table View ── */}
        {viewMode === 'table' && (
          <div style={{
            border: '1px solid var(--border)', borderRadius: 3,
            background: 'var(--bg-card)', overflow: 'hidden',
          }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '24px 1fr 100px 80px 80px',
              padding: '10px 18px',
              borderBottom: '1px solid var(--border)',
              fontSize: 8, letterSpacing: 2, textTransform: 'uppercase',
              color: 'var(--text-faint)', fontWeight: 700,
              alignItems: 'center',
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
                  padding: '40px 18px', textAlign: 'center',
                  fontSize: 11, color: 'var(--text-faint)',
                }}>
                  {searchQuery ? 'No entities match your search' : 'No entities found'}
                </div>
              )}
              {filteredEntities.map((e: any) => {
                const ec = ENTITY_COLORS[e.type] || { color: '#6b7280', label: e.type };
                const maxMentions = filteredEntities[0]?.mentions || 1;
                const barPct = (e.mentions / maxMentions) * 100;
                return (
                  <div
                    key={e.name}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '24px 1fr 100px 80px 80px',
                      padding: '10px 18px',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 11,
                      alignItems: 'center',
                      transition: 'background 0.12s',
                      cursor: 'default',
                    }}
                    onMouseEnter={(ev) => { (ev.currentTarget as HTMLDivElement).style.background = 'var(--bg-warm)'; }}
                    onMouseLeave={(ev) => { (ev.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: ec.color,
                      display: 'inline-block',
                      boxShadow: `0 0 3px ${ec.color}30`,
                    }} />
                    <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                        width: 48, height: 4, background: 'var(--border)',
                        borderRadius: 2, overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%', width: `${barPct}%`,
                          background: ec.color,
                          borderRadius: 2,
                          opacity: 0.6,
                          transition: 'width 0.8s ease',
                        }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>}
    </div>
  );
}
