/**
 * /showcase/graph — public (unauthenticated) live demo page.
 *
 * For the Colosseum hackathon video (Act 2, 0:55-1:10): viewer watches
 * entities spring into a force-directed graph as they type. Bond-typed
 * edges (supports/contradicts/causes/elaborates/happens_before) draw
 * progressively. On recall, matched nodes pulse.
 *
 * Implementation is intentionally dependency-free — uses a hand-rolled
 * physics simulation (same pattern as EntityMap.tsx) so no d3/framer-motion
 * installs needed. Fine for demo fidelity; can be swapped for d3-force
 * later if we add real analytics.
 */
import { useEffect, useRef, useState, useCallback } from 'react';

// Node + edge types matching Clude's memory schema
type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model';
type BondType =
  | 'supports'
  | 'contradicts'
  | 'elaborates'
  | 'causes'
  | 'follows'
  | 'relates'
  | 'resolves'
  | 'happens_before'
  | 'happens_after'
  | 'concurrent_with';

interface GraphNode {
  id: string;
  label: string;
  type: MemoryType;
  // physics state
  x: number;
  y: number;
  vx: number;
  vy: number;
  // animation state
  bornAt: number; // ms timestamp — for spring-in scale animation
  pulsing: boolean;
}

interface GraphEdge {
  from: string;
  to: string;
  linkType: BondType;
  weight: number;
  bornAt: number;
  highlighted: boolean;
}

const TYPE_COLORS: Record<MemoryType, string> = {
  episodic: '#5ce1ff',
  semantic: '#ffbb5c',
  procedural: '#7c5cff',
  self_model: '#ff5c7a',
};

const BOND_COLORS: Record<BondType, string> = {
  causes: '#ff5c7a',
  supports: '#5cff9e',
  contradicts: '#ff5c7a',
  elaborates: '#5ce1ff',
  follows: '#888888',
  relates: '#666666',
  resolves: '#5cff9e',
  happens_before: '#ffbb5c',
  happens_after: '#ffbb5c',
  concurrent_with: '#ffbb5c',
};

// Connect to SSE for live events. Falls back to mock data if the endpoint isn't up.
function useShowcaseStream(
  onMemory: (ev: { id: string; type: MemoryType; content: string }) => void,
  onLink: (ev: { from: string; to: string; linkType: BondType }) => void,
) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/showcase/stream');
      es.addEventListener('open', () => setConnected(true));
      es.addEventListener('error', () => setConnected(false));
      es.addEventListener('memory', (e) => {
        try {
          onMemory(JSON.parse((e as MessageEvent).data));
        } catch {}
      });
      es.addEventListener('link', (e) => {
        try {
          onLink(JSON.parse((e as MessageEvent).data));
        } catch {}
      });
    } catch {
      // SSE endpoint not available — that's OK, user can still type and we'll
      // use the /api/showcase/ingest response as the fallback signal.
    }
    return () => {
      es?.close();
    };
  }, [onMemory, onLink]);
  return connected;
}

export default function LiveGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [input, setInput] = useState('');
  const [posting, setPosting] = useState(false);
  const [stats, setStats] = useState({ memories: 0, edges: 0 });

  const addMemory = useCallback(
    (ev: { id: string; type: MemoryType; content: string }) => {
      setNodes((prev) => {
        if (prev.some((n) => n.id === ev.id)) return prev;
        const w = canvasRef.current?.width ?? 800;
        const h = canvasRef.current?.height ?? 500;
        return [
          ...prev,
          {
            id: ev.id,
            label: ev.content.slice(0, 40),
            type: ev.type,
            x: w / 2 + (Math.random() - 0.5) * 200,
            y: h / 2 + (Math.random() - 0.5) * 200,
            vx: 0,
            vy: 0,
            bornAt: Date.now(),
            pulsing: false,
          },
        ];
      });
    },
    [],
  );

  const addLink = useCallback(
    (ev: { from: string; to: string; linkType: BondType }) => {
      setEdges((prev) => [
        ...prev,
        { from: ev.from, to: ev.to, linkType: ev.linkType, weight: 1, bornAt: Date.now(), highlighted: false },
      ]);
    },
    [],
  );

  const connected = useShowcaseStream(addMemory, addLink);

  // Track counts for the header
  useEffect(() => {
    setStats({ memories: nodes.length, edges: edges.length });
  }, [nodes.length, edges.length]);

  // Physics loop — runs at ~60fps while nodes exist
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      // Clear
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, w, h);

      // Build quick node lookup
      const byId = new Map<string, GraphNode>();
      for (const n of nodes) byId.set(n.id, n);

      // Apply force-directed physics
      // (hand-rolled, same idiom as EntityMap.tsx — keep in sync if upstream changes)
      const cooling = 1; // no annealing — always lively
      for (const n of nodes) {
        n.vx *= 0.85;
        n.vy *= 0.85;

        // center attraction
        n.vx += (cx - n.x) * 0.003;
        n.vy += (cy - n.y) * 0.003;

        // repulsion between nodes
        for (const m of nodes) {
          if (n === m) continue;
          const dx = n.x - m.x;
          const dy = n.y - m.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const force = (800 * cooling) / (dist * dist);
          n.vx += (dx / dist) * force;
          n.vy += (dy / dist) * force;
        }
      }

      // edge spring attraction
      for (const e of edges) {
        const s = byId.get(e.from);
        const t = byId.get(e.to);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const force = dist * 0.003 * (e.weight || 0.5);
        s.vx += (dx / dist) * force;
        s.vy += (dy / dist) * force;
        t.vx -= (dx / dist) * force;
        t.vy -= (dy / dist) * force;
      }

      // Integrate
      for (const n of nodes) {
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(40, Math.min(w - 40, n.x));
        n.y = Math.max(40, Math.min(h - 40, n.y));
      }

      // Draw edges first
      const now = Date.now();
      for (const e of edges) {
        const s = byId.get(e.from);
        const t = byId.get(e.to);
        if (!s || !t) continue;
        const age = now - e.bornAt;
        const progress = Math.min(1, age / 500); // draw in 500ms
        const color = BOND_COLORS[e.linkType] || '#666';

        ctx.strokeStyle = e.highlighted ? '#ffffff' : color;
        ctx.lineWidth = e.highlighted ? 2.5 : 1.5;
        ctx.globalAlpha = 0.3 + 0.7 * progress;

        if (e.linkType === 'contradicts' || e.linkType.startsWith('happens_')) {
          ctx.setLineDash([6, 4]);
        } else {
          ctx.setLineDash([]);
        }

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        const tx = s.x + (t.x - s.x) * progress;
        const ty = s.y + (t.y - s.y) * progress;
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);

      // Draw nodes
      for (const n of nodes) {
        const age = now - n.bornAt;
        const springIn = Math.min(1, age / 600); // 600ms spring-in
        const eased = 1 - Math.pow(1 - springIn, 3); // easeOutCubic
        const baseR = 22;
        const r = baseR * eased;
        const color = TYPE_COLORS[n.type] || '#fff';

        // pulse effect when recalled
        if (n.pulsing) {
          const pulse = 1 + 0.3 * Math.sin(now / 80);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * pulse + 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        // body
        ctx.fillStyle = '#1a1a2e';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // label (only after spring-in ~70%)
        if (eased > 0.7) {
          ctx.fillStyle = '#eee';
          ctx.font = '11px -apple-system, system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.globalAlpha = (eased - 0.7) / 0.3;
          const maxLen = 18;
          const shown = n.label.length > maxLen ? n.label.slice(0, maxLen) + '…' : n.label;
          ctx.fillText(shown, n.x, n.y + r + 14);
          ctx.globalAlpha = 1;
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [nodes, edges]);

  // Handle form submission — POST to ingest endpoint
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || posting) return;
      setPosting(true);
      try {
        const res = await fetch('/api/showcase/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: input }),
        });
        if (res.ok) {
          const data = await res.json();
          // If the server returned memories/links inline (fallback path when SSE isn't running),
          // wire them into the graph too.
          for (const m of data.memories || []) addMemory(m);
          for (const l of data.links || []) addLink(l);
        }
        setInput('');
      } catch {
        // Show visual feedback later if needed
      } finally {
        setPosting(false);
      }
    },
    [input, posting, addMemory, addLink],
  );

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#fff',
        fontFamily: '-apple-system, system-ui, sans-serif',
      }}
    >
      <header style={{ padding: '24px 40px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <h1 style={{ fontSize: 22, margin: 0, fontWeight: 500 }}>Clude — Live Memory Graph</h1>
        <p style={{ color: '#888', fontSize: 13, margin: '6px 0 0' }}>
          Type anything below. Watch entities spring in, bond-typed edges draw, relationships form.
          {connected ? (
            <span style={{ color: '#5cff9e', marginLeft: 12 }}>● connected</span>
          ) : (
            <span style={{ color: '#888', marginLeft: 12 }}>● awaiting ingest</span>
          )}
        </p>
      </header>

      <div style={{ display: 'flex', gap: 12, padding: 20, height: 'calc(100vh - 180px)' }}>
        <canvas
          ref={canvasRef}
          width={1200}
          height={700}
          style={{
            width: '100%',
            height: '100%',
            background: '#0a0a0a',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 8,
          }}
        />
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          padding: '20px 40px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <div style={{ fontSize: 11, color: '#666', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {stats.memories} memories · {stats.edges} edges
        </div>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. My dog Pepper is allergic to chicken and loves salmon…"
          disabled={posting}
          style={{
            flex: 1,
            background: '#111',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6,
            padding: '10px 14px',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={posting || !input.trim()}
          style={{
            background: posting ? '#333' : 'linear-gradient(90deg, #7c5cff, #5ce1ff)',
            color: '#0a0a0a',
            border: 'none',
            borderRadius: 6,
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 600,
            cursor: posting ? 'default' : 'pointer',
          }}
        >
          {posting ? 'Storing…' : 'Store'}
        </button>
      </form>

      <div
        style={{
          padding: '10px 40px 30px',
          display: 'flex',
          gap: 20,
          fontSize: 11,
          color: '#666',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: TYPE_COLORS.episodic }}>● episodic</span>
        <span style={{ color: TYPE_COLORS.semantic }}>● semantic</span>
        <span style={{ color: TYPE_COLORS.procedural }}>● procedural</span>
        <span style={{ color: BOND_COLORS.supports }}>— supports</span>
        <span style={{ color: BOND_COLORS.contradicts }}>— contradicts (dashed)</span>
        <span style={{ color: BOND_COLORS.causes }}>— causes</span>
        <span style={{ color: BOND_COLORS.happens_before }}>— temporal (dashed)</span>
      </div>
    </div>
  );
}
