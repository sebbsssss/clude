/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/refs */
import { useEffect, useRef, useCallback } from 'react';
// @ts-expect-error 3d-force-graph callable vs new mismatch
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import type { MemoryLink } from '../types/memory';

interface GraphNode {
  id: number;
  type: string;
  summary: string;
  content: string;
  tags: string[];
  importance: number;
  decay: number;
  valence: number;
  accessCount: number;
  source: string;
  createdAt: string;
}

interface FGNode extends GraphNode {
  x?: number;
  y?: number;
  z?: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
}

interface FGLink extends MemoryLink {
  source: any;
  target: any;
}

// Softer palette — works on light (#f5f5f0) and dark (#0a0a0f) backgrounds
const TYPE_COLORS_CSS: Record<string, string> = {
  episodic: '#6680cc',     // soft blue-gray
  semantic: '#5aaa8a',     // muted teal
  procedural: '#c49550',   // warm amber
  self_model: '#9580c4',   // soft purple
};

// Highlighted versions — richer, used for chain/selected states
const TYPE_COLORS_ACTIVE: Record<string, string> = {
  episodic: '#4466ff',
  semantic: '#10b981',
  procedural: '#f59e0b',
  self_model: '#8b5cf6',
};

const LINK_COLORS: Record<string, string> = {
  supports: 'rgba(16, 185, 129, 0.6)',
  contradicts: 'rgba(239, 68, 68, 0.6)',
  elaborates: 'rgba(68, 102, 255, 0.55)',
  causes: 'rgba(245, 158, 11, 0.6)',
  follows: 'rgba(6, 182, 212, 0.55)',
  relates: 'rgba(120, 120, 140, 0.35)',
  resolves: 'rgba(139, 92, 246, 0.55)',
  happens_before: 'rgba(167, 139, 250, 0.5)',
  happens_after: 'rgba(167, 139, 250, 0.5)',
  concurrent_with: 'rgba(236, 72, 153, 0.5)',
};

interface SearchResult {
  id: number;
  _score?: number;
  [key: string]: any;
}

interface Props {
  nodes: GraphNode[];
  links: MemoryLink[];
  highlightedIds: Set<number>;
  searchResults: SearchResult[];
  narrativeChain: number[];
  selectedId: number | null;
  onNodeClick: (node: GraphNode) => void;
  onBackgroundClick: () => void;
}

export function MemoryGraph3D({ nodes, links, highlightedIds, searchResults, narrativeChain, selectedId, onNodeClick, onBackgroundClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const highlightRef = useRef<Set<number>>(highlightedIds);
  const selectedRef = useRef<number | null>(selectedId);
  const pinnedNodesRef = useRef<Set<number>>(new Set());

  highlightRef.current = highlightedIds;
  selectedRef.current = selectedId;
  const narrativeRef = useRef<number[]>(narrativeChain);
  narrativeRef.current = narrativeChain;

  // Initialize graph
  useEffect(() => {
    const container = containerRef.current;
    if (!container || graphRef.current) return;

    // Wait a frame for layout to compute
    requestAnimationFrame(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;

      const graph = ForceGraph3D()(container)
        .width(w)
        .height(h)
        .backgroundColor('rgba(0,0,0,0)')
        .showNavInfo(false)
        .nodeId('id')
        .linkSource('source_id')
        .linkTarget('target_id')
        // ── Nodes ──
        .nodeColor((node: any) => {
          const n = node as FGNode;
          const hl = highlightRef.current;
          const sel = selectedRef.current;
          // Selected: bright accent color
          if (n.id === sel) return TYPE_COLORS_ACTIVE[n.type] || '#4466ff';
          // Highlighted (in chain): richer color
          if (hl.size > 0 && hl.has(n.id)) return TYPE_COLORS_ACTIVE[n.type] || '#4466ff';
          // Dimmed (search active but not in results): ghostlike
          if (hl.size > 0) return 'rgba(180, 180, 185, 0.18)';
          // Default: visible, solid
          return TYPE_COLORS_CSS[n.type] || '#9098a8';
        })
        .nodeVal((node: any) => {
          const n = node as FGNode;
          const sel = selectedRef.current;
          const hl = highlightRef.current;
          if (n.id === sel) return 3 + n.importance * 10;
          if (hl.size > 0 && hl.has(n.id)) return 2.5 + n.importance * 8;
          if (hl.size > 0) return 0.5 + n.importance * 2;
          return 1.5 + n.importance * 6;
        })
        .nodeOpacity(1)
        .nodeResolution(16)
        .nodeLabel((node: any) => {
          const n = node as FGNode;
          const s = n.summary || '';
          return `<div style="max-width:260px;font-size:10px;font-family:'JetBrains Mono',monospace;padding:5px 8px;background:rgba(255,255,252,0.95);border:1px solid rgba(0,0,0,0.08);border-radius:6px;color:#333;box-shadow:0 2px 12px rgba(0,0,0,0.08);line-height:1.4">${s.length > 100 ? s.slice(0, 100) + '...' : s}</div>`;
        })
        // ── Links ──
        .linkColor((link: any) => {
          const l = link as FGLink;
          const hl = highlightRef.current;
          // Narrative chain: clean accent line
          if (l.link_type === '__narrative__') return 'rgba(68, 102, 255, 0.6)';
          if (hl.size > 0) {
            const srcId = typeof l.source === 'object' ? l.source.id : l.source;
            const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
            // Both ends highlighted: show link with moderate opacity
            if (hl.has(srcId) && hl.has(tgtId)) return LINK_COLORS[l.link_type]?.replace('0.4', '0.6') || 'rgba(100,100,120,0.3)';
            // Dimmed: nearly invisible
            return 'rgba(180,180,185,0.04)';
          }
          // Default: clearly visible
          return LINK_COLORS[l.link_type] || 'rgba(120,120,140,0.45)';
        })
        .linkWidth((link: any) => {
          const l = link as FGLink;
          if (l.link_type === '__narrative__') return 2;
          const hl = highlightRef.current;
          if (hl.size > 0) {
            const srcId = typeof l.source === 'object' ? l.source.id : l.source;
            const tgtId = typeof l.target === 'object' ? l.target.id : l.target;
            if (hl.has(srcId) && hl.has(tgtId)) return 1 + l.strength * 2;
          }
          return 0.5 + l.strength * 1;
        })
        .linkOpacity(0.8)
        .linkDirectionalArrowLength((link: any) => {
          return (link as FGLink).link_type === '__narrative__' ? 3 : 0;
        })
        .linkDirectionalArrowRelPos(1)
        .linkDirectionalArrowColor((link: any) => {
          return (link as FGLink).link_type === '__narrative__' ? 'rgba(68, 102, 255, 0.5)' : 'transparent';
        })
        .linkDirectionalParticles((link: any) => {
          const l = link as FGLink;
          // Narrative chain: small subtle particles
          if (l.link_type === '__narrative__') return 2;
          return 0;
        })
        .linkDirectionalParticleWidth(0.8)
        .linkDirectionalParticleSpeed(0.005)
        .linkDirectionalParticleColor((link: any) => {
          return (link as FGLink).link_type === '__narrative__' ? 'rgba(68, 102, 255, 0.7)' : 'transparent';
        })
        // ── Interaction ──
        .onNodeClick((node: any) => onNodeClick(node as GraphNode))
        .onBackgroundClick(() => onBackgroundClick())
        .onNodeHover((node: any) => {
          if (container) container.style.cursor = node ? 'pointer' : 'default';
        })
        .onNodeDragEnd((node: any) => {
          // Keep pinned chain nodes fixed after drag
          const n = node as FGNode;
          if (pinnedNodesRef.current.has(n.id)) {
            n.fx = n.x;
            n.fy = n.y;
            n.fz = n.z;
          }
        })
        .enableNodeDrag(true)
        // ── Physics — keep simulation alive so nodes drift ──
        .d3AlphaDecay(0.005)    // very slow decay — nodes keep moving longer
        .d3VelocityDecay(0.15)  // less damping — more momentum
        .warmupTicks(80)
        .cooldownTime(15000);   // 15s before settling

      // Tune forces
      const charge = graph.d3Force('charge');
      if (charge && typeof charge.strength === 'function') {
        charge.strength(-40);
      }
      const link = graph.d3Force('link');
      if (link && typeof link.distance === 'function') {
        link.distance(30);
      }

      // Slow auto-rotate when user isn't interacting
      const controls = graph.controls();
      if (controls) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.5;
        // Stop auto-rotate when user drags, resume after
        controls.addEventListener('start', () => { controls.autoRotate = false; });
        controls.addEventListener('end', () => {
          setTimeout(() => { controls.autoRotate = true; }, 3000);
        });
      }

      // Subtle fog — warm tint matching light background
      const scene = graph.scene();
      scene.fog = new THREE.FogExp2(0xf5f5f0, 0.0004);

      // Ambient dust — very faint, warm gray dots for depth
      const dustGeo = new THREE.BufferGeometry();
      const dustPos = new Float32Array(200 * 3);
      for (let i = 0; i < 200; i++) {
        dustPos[i * 3] = (Math.random() - 0.5) * 400;
        dustPos[i * 3 + 1] = (Math.random() - 0.5) * 400;
        dustPos[i * 3 + 2] = (Math.random() - 0.5) * 400;
      }
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
      const dustMat = new THREE.PointsMaterial({
        size: 0.3,
        color: 0xaaaaaa,
        transparent: true,
        opacity: 0.15,
        depthWrite: false,
      });
      scene.add(new THREE.Points(dustGeo, dustMat));

      graphRef.current = graph;

      // Set initial data if available
      if (nodes.length > 0) {
        graph.graphData({
          nodes: nodes.map(n => ({ ...n })),
          links: links.map(l => ({ ...l })),
        });
      }

      // ── Fire/wave state per node ──
      const fireMap = new Map<number, number>(); // nodeId -> fire level (0-1)

      // Build adjacency map for wave propagation
      const buildAdjacency = () => {
        const adj = new Map<number, number[]>();
        const gd = graph.graphData();
        for (const link of gd.links) {
          const srcId = typeof link.source === 'object' ? link.source.id : link.source_id || link.source;
          const tgtId = typeof link.target === 'object' ? link.target.id : link.target_id || link.target;
          if (!adj.has(srcId)) adj.set(srcId, []);
          if (!adj.has(tgtId)) adj.set(tgtId, []);
          adj.get(srcId)!.push(tgtId);
          adj.get(tgtId)!.push(srcId);
        }
        return adj;
      };

      // Random fire event every 2-4 seconds — only when idle (no search active)
      const fireInterval = setInterval(() => {
        if (highlightRef.current.size > 0) return; // skip during search
        const gd = graph.graphData();
        if (gd.nodes.length === 0) return;
        const randomNode = gd.nodes[Math.floor(Math.random() * gd.nodes.length)];
        fireMap.set((randomNode as any).id, 1.0);

        // Propagate wave to neighbors with delay
        const adj = buildAdjacency();
        const neighbors = adj.get((randomNode as any).id) || [];
        neighbors.forEach((nId, i) => {
          setTimeout(() => {
            fireMap.set(nId, 0.6);
            // Second hop
            const hop2 = adj.get(nId) || [];
            hop2.forEach((n2Id) => {
              setTimeout(() => {
                if ((fireMap.get(n2Id) || 0) < 0.3) fireMap.set(n2Id, 0.3);
              }, 150);
            });
          }, 100 + i * 50);
        });
      }, 2500 + Math.random() * 1500);

      // Periodically reheat physics so nodes keep gently drifting
      const reheatInterval = setInterval(() => {
        graph.d3ReheatSimulation();
      }, 12000);

      // ── Standalone animation loop ──
      let animId = 0;
      const animate = () => {
        animId = requestAnimationFrame(animate);
        const t = performance.now() * 0.001;
        const renderer = graph.renderer();
        const gScene = graph.scene();
        const cam = graph.camera();

        const gd = graph.graphData();
        for (const node of gd.nodes) {
          const obj = (node as any).__threeObj;
          if (!obj) continue;
          const id = (node as any).id;
          const phase = (id * 0.17) % (Math.PI * 2);

          // Fire decay
          const fire = fireMap.get(id) || 0;
          if (fire > 0) {
            fireMap.set(id, fire * 0.96); // decay per frame
            if (fire < 0.01) fireMap.delete(id);
          }

          // Breathing — subtle when search active, more when idle
          const hasSearch = highlightRef.current.size > 0;
          const breathAmount = hasSearch ? 0.03 : 0.1;
          const breath = 1 + Math.sin(t * 1.0 + phase) * breathAmount;
          const fireScale = 1 + fire * 0.4;
          obj.scale.setScalar(breath * fireScale);

          // Fire glow: brighten the material
          if (obj.material) {
            if (fire > 0.05) {
              obj.material.emissive = obj.material.emissive || new THREE.Color();
              obj.material.emissive.setHex(0xffffff);
              obj.material.emissiveIntensity = fire * 0.4;
            } else if (obj.material.emissiveIntensity > 0) {
              obj.material.emissiveIntensity = 0;
            }
          }

          // Floating drift
          const driftX = Math.sin(t * 0.3 + phase) * 0.15;
          const driftY = Math.cos(t * 0.25 + phase * 1.3) * 0.15;
          const driftZ = Math.sin(t * 0.2 + phase * 0.7) * 0.15;
          obj.position.x = (node.x || 0) + driftX;
          obj.position.y = (node.y || 0) + driftY;
          obj.position.z = (node.z || 0) + driftZ;
        }

        // Auto-rotate only when idle (no search, no selection)
        const ctrl = graph.controls();
        if (ctrl) {
          const idle = highlightRef.current.size === 0 && !selectedRef.current;
          ctrl.autoRotate = idle;
          if (ctrl.update) ctrl.update();
        }

        // Render
        if (renderer && gScene && cam) {
          renderer.render(gScene, cam);
        }
      };
      animate();

      // Store for cleanup
      (graph as any).__animId = animId;
      (graph as any).__fireInterval = fireInterval;
      (graph as any).__reheatInterval = reheatInterval;
      (graph as any).__fireMap = fireMap;
    });

    const handleResize = () => {
      if (graphRef.current && container) {
        graphRef.current.width(container.clientWidth);
        graphRef.current.height(container.clientHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (graphRef.current) {
        const g = graphRef.current as any;
        if (g.__animId) cancelAnimationFrame(g.__animId);
        if (g.__fireInterval) clearInterval(g.__fireInterval);
        if (g.__reheatInterval) clearInterval(g.__reheatInterval);
        graphRef.current._destructor();
        graphRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update data when nodes/links/chain change
  useEffect(() => {
    if (!graphRef.current || nodes.length === 0) return;

    // Build narrative chain links (directional, bright)
    const chainLinks: any[] = [];
    for (let i = 0; i < narrativeChain.length - 1; i++) {
      chainLinks.push({
        source_id: narrativeChain[i],
        target_id: narrativeChain[i + 1],
        link_type: '__narrative__',
        strength: 1,
      });
    }

    graphRef.current.graphData({
      nodes: nodes.map(n => ({ ...n })),
      links: [...links.map(l => ({ ...l })), ...chainLinks],
    });
  }, [nodes, links, narrativeChain]);

  // Refresh visuals on search change + clear fire
  useEffect(() => {
    if (!graphRef.current) return;
    const g = graphRef.current;
    // Clear fire effects when search is active
    const fm = (g as any).__fireMap as Map<number, number> | undefined;
    if (fm && highlightedIds.size > 0) fm.clear();
    g.nodeColor(g.nodeColor())
     .linkColor(g.linkColor())
     .linkWidth(g.linkWidth())
     .linkDirectionalParticles(g.linkDirectionalParticles())
     .refresh();
  }, [highlightedIds]);

  // ── Search chain: pin results in narrative order horizontally ──
  const arrangeChain = useCallback(() => {
    if (!graphRef.current) return;
    const chain = narrativeRef.current;
    if (chain.length === 0) return;
    const g = graphRef.current;
    const graphData = g.graphData();

    // Use narrative chain order (as LLM referenced them)
    const ids = new Set(chain);

    // Horizontal layout along X axis, centered at origin, fixed Y=0
    const spacing = 30;
    const totalWidth = (chain.length - 1) * spacing;
    const startX = -totalWidth / 2;

    for (const node of graphData.nodes) {
      const n = node as FGNode;
      if (ids.has(n.id)) {
        const idx = chain.indexOf(n.id);
        n.fx = startX + idx * spacing;
        n.fy = 0; // flat horizontal plane
        n.fz = 0;
        pinnedNodesRef.current.add(n.id);
      } else if (pinnedNodesRef.current.has(n.id)) {
        n.fx = null; n.fy = null; n.fz = null;
        pinnedNodesRef.current.delete(n.id);
      }
    }

    g.d3ReheatSimulation();

    // Camera: pull back enough to see the full chain comfortably
    const viewDist = Math.max(totalWidth * 1.5, 200);
    g.cameraPosition(
      { x: 0, y: viewDist * 0.4, z: viewDist * 0.7 }, // further back, slightly above
      { x: 0, y: 0, z: 0 },
      1200,
    );
  }, []);

  const releaseChain = useCallback(() => {
    if (!graphRef.current) return;
    const graphData = graphRef.current.graphData();
    for (const node of graphData.nodes) {
      const n = node as FGNode;
      if (pinnedNodesRef.current.has(n.id)) {
        n.fx = null; n.fy = null; n.fz = null;
      }
    }
    pinnedNodesRef.current.clear();
    graphRef.current.d3ReheatSimulation();
  }, []);

  useEffect(() => {
    if (!graphRef.current) return;
    if (searchResults.length > 0) {
      setTimeout(() => arrangeChain(), 300);
    } else {
      releaseChain();
    }
  }, [searchResults, arrangeChain, releaseChain]);

  // Highlight nodes during streaming (just update colors, no graph rebuild)
  useEffect(() => {
    if (!graphRef.current) return;
    const g = graphRef.current;
    g.nodeColor(g.nodeColor()).refresh();
  }, [highlightedIds]);

  // Focus on selected node + refresh visuals
  useEffect(() => {
    if (!graphRef.current) return;
    const g = graphRef.current;
    // Refresh colors/sizes to reflect new selection
    g.nodeColor(g.nodeColor())
     .nodeVal(g.nodeVal())
     .refresh();

    if (!selectedId) return;
    const graphData = g.graphData();
    const node = graphData.nodes.find((n: any) => n.id === selectedId);
    if (!node) return;
    g.cameraPosition(
      { x: (node.x || 0) + 50, y: (node.y || 0) + 30, z: (node.z || 0) + 50 },
      { x: node.x || 0, y: node.y || 0, z: node.z || 0 },
      800,
    );
  }, [selectedId]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
    />
  );
}
