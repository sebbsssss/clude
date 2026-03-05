import { useEffect, useState, useRef } from 'react';
import { api } from '../lib/api';
import { useAuthContext } from '../hooks/AuthContext';
import type { KnowledgeGraph } from '../types/memory';

const ENTITY_COLORS: Record<string, string> = {
  person: '#2244ff',
  project: '#10b981',
  concept: '#8b5cf6',
  token: '#f59e0b',
  wallet: '#ef4444',
  location: '#06b6d4',
  event: '#ec4899',
};

export function EntityMap() {
  const { authMode } = useAuthContext();
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [graphStats, setGraphStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [includeMemories, setIncludeMemories] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const nodesRef = useRef<Array<any>>([]);

  useEffect(() => {
    if (authMode === 'cortex') {
      setLoading(false);
      return;
    }
    Promise.all([
      api.getKnowledgeGraph({ includeMemories, minMentions: 1 }),
      api.getGraphStats(),
    ]).then(([g, s]) => {
      setGraph(g);
      setGraphStats(s);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [includeMemories]);

  // Simple force-directed layout on canvas
  useEffect(() => {
    if (!graph || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const width = canvas.offsetWidth;
    const height = canvas.offsetHeight;
    canvas.width = width * 2;
    canvas.height = height * 2;
    ctx.scale(2, 2);

    // Initialize positions
    const nodes = graph.nodes.map((n, i) => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * width * 0.6,
      y: height / 2 + (Math.random() - 0.5) * height * 0.6,
      vx: 0,
      vy: 0,
    }));

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    nodesRef.current = nodes;

    // Simple force simulation
    let animFrame: number;
    let iteration = 0;
    const maxIterations = 200;

    function simulate() {
      if (iteration >= maxIterations) return;

      // Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 800 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          nodes[i].vx -= fx;
          nodes[i].vy -= fy;
          nodes[j].vx += fx;
          nodes[j].vy += fy;
        }
      }

      // Attraction along edges
      for (const edge of graph!.edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) continue;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const force = dist * 0.005 * (edge.weight || 0.5);
        source.vx += (dx / dist) * force;
        source.vy += (dy / dist) * force;
        target.vx -= (dx / dist) * force;
        target.vy -= (dy / dist) * force;
      }

      // Center gravity
      for (const node of nodes) {
        node.vx += (width / 2 - node.x) * 0.001;
        node.vy += (height / 2 - node.y) * 0.001;
      }

      // Apply velocities with damping
      const damping = 0.85;
      for (const node of nodes) {
        node.vx *= damping;
        node.vy *= damping;
        node.x += node.vx;
        node.y += node.vy;
        // Keep in bounds
        node.x = Math.max(40, Math.min(width - 40, node.x));
        node.y = Math.max(40, Math.min(height - 40, node.y));
      }

      // Draw
      ctx.clearRect(0, 0, width, height);

      // Edges
      for (const edge of graph!.edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) continue;

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.strokeStyle = `rgba(0, 0, 0, ${0.03 + (edge.weight || 0.5) * 0.08})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Nodes
      for (const node of nodes) {
        const color = ENTITY_COLORS[node.type] || '#6b7280';
        const radius = Math.max(3, node.size / 3);

        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        // Label
        if (node.size > 8) {
          ctx.font = '10px JetBrains Mono';
          ctx.fillStyle = 'var(--text)';
          ctx.textAlign = 'center';
          ctx.fillText(node.label, node.x, node.y + radius + 14);
        }
      }

      iteration++;
      animFrame = requestAnimationFrame(simulate);
    }

    simulate();

    // Click handling
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      for (const node of nodes) {
        const dx = node.x - x;
        const dy = node.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < Math.max(8, node.size / 3) + 4) {
          setSelectedNode(node);
          return;
        }
      }
      setSelectedNode(null);
    };

    canvas.addEventListener('click', handleClick);

    return () => {
      cancelAnimationFrame(animFrame);
      canvas.removeEventListener('click', handleClick);
    };
  }, [graph]);

  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>
          Knowledge Graph
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 }}>
          Entity Map
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {graph?.nodes.length || 0} entities, {graph?.edges.length || 0} relationships
        </p>
      </div>

      {authMode === 'cortex' && (
        <div style={{
          border: '1px solid var(--border)',
          padding: '40px 20px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
          lineHeight: 1.8,
        }}>
          <div style={{ fontSize: 24, opacity: 0.2, marginBottom: 16 }}>◎</div>
          Entity graph requires self-hosted mode.<br />
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            Set up your own Supabase to use the knowledge graph.
          </span>
        </div>
      )}

      {authMode !== 'cortex' && <>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center' }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={includeMemories}
            onChange={(e) => setIncludeMemories(e.target.checked)}
          />
          Show memories
        </label>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginLeft: 'auto', fontSize: 10 }}>
          {Object.entries(ENTITY_COLORS).map(([type, color]) => (
            <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
              {type}
            </span>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div style={{ border: '1px solid var(--border)', position: 'relative' }}>
        {loading ? (
          <div style={{ height: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }}>
            Loading graph...
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: 500, display: 'block', background: 'var(--bg)' }}
          />
        )}

        {/* Selected node info */}
        {selectedNode && (
          <div style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'var(--bg)',
            border: '1px solid var(--border-strong)',
            padding: 16,
            maxWidth: 240,
            fontSize: 12,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{selectedNode.label}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              {selectedNode.type}
            </div>
          </div>
        )}
      </div>

      {/* Top Entities Table */}
      {graphStats && (
        <div style={{ border: '1px solid var(--border)', marginTop: 24 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: 'var(--text-faint)' }}>
            Top Entities
          </div>
          {graphStats.topEntities.map((e: any) => (
            <div key={e.name} style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 20px',
              borderBottom: '1px solid var(--border)',
              fontSize: 12,
            }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: ENTITY_COLORS[e.type] || '#6b7280',
                marginRight: 12,
              }} />
              <span style={{ flex: 1 }}>{e.name}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase', marginRight: 16 }}>{e.type}</span>
              <span style={{ color: 'var(--text-muted)' }}>{e.mentions} mentions</span>
            </div>
          ))}
        </div>
      )}
      </>}
    </div>
  );
}
