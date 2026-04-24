import { useState, useMemo, useCallback, useEffect } from 'react';
import { useExploreData } from '../hooks/use-explore-data';
import { MemoryGraph3D } from '../components/memory-graph-3d';
import { MemoryDetailPanel } from '../components/memory-detail-panel';
import { ExploreChat } from '../components/explore-chat';

export function Explore() {
  const { nodes, links, loading, error } = useExploreData();

  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());
  const [focusNodeId, setFocusNodeId] = useState<number | null>(null);

  // Esc to deselect
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedNode(null); setHighlightedIds(new Set()); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const filteredNodes = nodes;

  // Node lookup map for detail panel
  const nodeMap = useMemo(() => {
    const map = new Map<number, any>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  // Extract known entity names from node tags (entity:Name format)
  const knownEntities = useMemo(() => {
    const entities = new Set<string>();
    for (const n of nodes) {
      for (const tag of n.tags) {
        if (tag.startsWith('entity:')) {
          const name = tag.slice(7);
          if (name.length > 1) entities.add(name);
        }
      }
    }
    return entities;
  }, [nodes]);


  const handleNavigate = useCallback((id: number) => {
    const node = nodeMap.get(id);
    if (node) setSelectedNode(node);
  }, [nodeMap]);

  // Click entity → set as active perspective (single entity only)
  const [activeEntity, setActiveEntity] = useState<string | null>(null);

  const handleEntityClick = useCallback((entity: string) => {
    setActiveEntity(prev => prev === entity ? null : entity);
  }, []);

  const handleMemoryClick = useCallback((id: number) => {
    const node = nodeMap.get(id);
    if (node) {
      setSelectedNode(node);
      return;
    }
    // Memory referenced in chat but not in the loaded graph — can happen if the
    // memory was created after the graph loaded, or is outside the loaded set.
    // Open the detail panel with a stub so user sees something, and warn so
    // we can confirm whether that's the zoom-stopped-working cause.
    console.warn(`[explore] Memory #${id} not in loaded graph (${nodeMap.size} nodes). Opening stub panel; 3D zoom needs the node to be loaded.`);
    setSelectedNode({
      id,
      type: 'episodic',
      summary: `Memory #${id}`,
      content: '(Not in loaded graph — refresh or reload to see full details.)',
      tags: [],
      importance: 0,
      decay: 1,
      valence: 0,
      accessCount: 0,
      source: '',
      createdAt: '',
    });
  }, [nodeMap]);

  const handleBackgroundClick = useCallback(() => { setSelectedNode(null); setHighlightedIds(new Set()); }, []);
  const handleClearEntity = useCallback(() => setActiveEntity(null), []);
  const handleFocusNode = useCallback((id: number) => {
    setFocusNodeId(id);
    setTimeout(() => setFocusNodeId(null), 100);
  }, []);

  return (
    <div className="explore-container" style={{
      height: 'calc(100vh - 80px)',
      position: 'relative',
      overflow: 'hidden',
      margin: '-40px',
      background: 'var(--bg)',
    }}>

      {/* Loading state */}
      {loading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', letterSpacing: 1 }}>
            Loading memory graph...
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10,
          textAlign: 'center',
          color: '#ef4444',
          fontSize: 11,
        }}>
          {error}
        </div>
      )}

      {/* 3D Graph */}
      {!loading && (
        <MemoryGraph3D
          nodes={filteredNodes}
          highlightedIds={highlightedIds}
          selectedId={selectedNode?.id || null}
          focusNodeId={focusNodeId}
          onNodeClick={setSelectedNode}
          onBackgroundClick={handleBackgroundClick}
        />
      )}

      {/* Chat panel — bottom */}
      <ExploreChat
        onHighlight={setHighlightedIds}
        onMemoryClick={handleMemoryClick}
        onFocusNode={handleFocusNode}
        onEntityClick={handleEntityClick}
        activeEntity={activeEntity}
        onClearEntity={handleClearEntity}
        knownEntities={knownEntities}
      />

      {/* Detail panel — right side */}
      <MemoryDetailPanel
        node={selectedNode}
        links={links}
        allNodes={nodeMap}
        onClose={() => setSelectedNode(null)}
        onNavigate={handleNavigate}
      />
    </div>
  );
}
