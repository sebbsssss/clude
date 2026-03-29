import { useState, useMemo, useCallback, useEffect } from 'react';
import { useExploreData } from '../hooks/use-explore-data';
import { MemoryGraph3D } from '../components/memory-graph-3d';
import { MemoryDetailPanel } from '../components/memory-detail-panel';
import { ExploreChat } from '../components/explore-chat';

const TYPE_COLORS: Record<string, string> = {
  episodic: '#2244ff',
  semantic: '#10b981',
  procedural: '#f59e0b',
  self_model: '#8b5cf6',
};

const TYPE_LABELS: Record<string, string> = {
  episodic: 'Episodic',
  semantic: 'Semantic',
  procedural: 'Procedural',
  self_model: 'Self-Model',
};

const LINK_COLORS: Record<string, string> = {
  supports: '#10b981',
  contradicts: '#ef4444',
  elaborates: '#2244ff',
  causes: '#f59e0b',
  follows: '#06b6d4',
  relates: '#6b7280',
};

export function Explore() {
  const { nodes, links, loading, error } = useExploreData();

  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set(['episodic', 'semantic', 'procedural', 'self_model']));
  const [highlightedIds, setHighlightedIds] = useState<Set<number>>(new Set());
  const [searchResults, setSearchResults] = useState<Array<{ id: number; _score?: number; [key: string]: any }>>([]);
  const [narrativeChain, setNarrativeChain] = useState<number[]>([]);

  // Esc to deselect
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedNode(null);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Filter nodes by type
  const filteredNodes = useMemo(
    () => nodes.filter(n => typeFilters.has(n.type)),
    [nodes, typeFilters],
  );

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map(n => n.id)),
    [filteredNodes],
  );

  const filteredLinks = useMemo(
    () => links.filter(l => filteredNodeIds.has(l.source_id) && filteredNodeIds.has(l.target_id)),
    [links, filteredNodeIds],
  );

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

  const toggleType = (type: string) => {
    setTypeFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const handleNavigate = useCallback((id: number) => {
    const node = nodeMap.get(id);
    if (node) setSelectedNode(node);
  }, [nodeMap]);

  const handleMemoryClick = useCallback((id: number) => {
    const node = nodeMap.get(id);
    if (node) setSelectedNode(node);
  }, [nodeMap]);

  // Count links by type for legend
  const linkTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of filteredLinks) {
      counts[l.link_type] = (counts[l.link_type] || 0) + 1;
    }
    return counts;
  }, [filteredLinks]);

  return (
    <div style={{
      height: 'calc(100vh - 80px)',
      position: 'relative',
      overflow: 'hidden',
      margin: '-40px',
      background: 'var(--bg)',
    }}>
      {/* Type filters — top left */}
      <div style={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        {Object.entries(TYPE_LABELS).map(([type, label]) => {
          const active = typeFilters.has(type);
          const count = nodes.filter(n => n.type === type).length;
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                fontSize: 9,
                fontFamily: 'var(--mono)',
                letterSpacing: 0.5,
                background: active ? `${TYPE_COLORS[type]}20` : 'rgba(255,255,255,0.03)',
                color: active ? TYPE_COLORS[type] : 'rgba(255,255,255,0.25)',
                border: `1px solid ${active ? `${TYPE_COLORS[type]}40` : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 4,
                cursor: 'pointer',
                textTransform: 'uppercase',
              }}
            >
              <div style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: active ? TYPE_COLORS[type] : 'rgba(255,255,255,0.15)',
              }} />
              {label} ({count})
            </button>
          );
        })}
      </div>

      {/* Stats — top right */}
      <div style={{
        position: 'absolute',
        top: 16,
        right: selectedNode ? 356 : 16,
        zIndex: 10,
        textAlign: 'right',
        transition: 'right 0.2s',
      }}>
        <div style={{ fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)' }}>
          Memory Explorer
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 2 }}>
          {filteredNodes.length}
        </div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>
          nodes / {filteredLinks.length} links
        </div>
      </div>

      {/* Link type legend — bottom left */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 10,
      }}>
        <div style={{ fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.2)', marginBottom: 4 }}>
          Link Types
        </div>
        {Object.entries(LINK_COLORS).map(([type, color]) => {
          const count = linkTypeCounts[type];
          if (!count) return null;
          return (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              <div style={{ width: 12, height: 2, background: color, borderRadius: 1 }} />
              <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.3)', letterSpacing: 0.5 }}>
                {type} ({count})
              </span>
            </div>
          );
        })}
      </div>

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
          links={filteredLinks}
          highlightedIds={highlightedIds}
          searchResults={searchResults}
          narrativeChain={narrativeChain}
          selectedId={selectedNode?.id || null}
          onNodeClick={setSelectedNode}
          onBackgroundClick={() => setSelectedNode(null)}
        />
      )}

      {/* Chat panel — bottom */}
      <ExploreChat
        onHighlight={setHighlightedIds}
        onNarrativeChain={setNarrativeChain}
        onMemoryClick={handleMemoryClick}
        knownEntities={knownEntities}
        searchResults={searchResults}
        setSearchResults={setSearchResults}
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
