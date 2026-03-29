import { useEffect, useState, useRef } from 'react';
import type { Memory, MemoryType } from '../types/memory';

const TYPE_COLORS: Record<MemoryType, string> = {
  episodic: '#2244ff',
  semantic: '#10b981',
  procedural: '#f59e0b',
  self_model: '#8b5cf6',
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ActivityFeed({ memories }: { memories: Memory[] }) {
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const prevIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    // Detect new memories
    const currentIds = new Set(memories.map((m) => m.id));
    const freshIds = new Set<number>();
    for (const id of currentIds) {
      if (!prevIdsRef.current.has(id)) {
        freshIds.add(id);
      }
    }
    prevIdsRef.current = currentIds;

    if (freshIds.size > 0) {
      setNewIds(freshIds);
      // Clear highlight after 3 seconds
      const timer = setTimeout(() => setNewIds(new Set()), 3000);
      return () => clearTimeout(timer);
    }
  }, [memories]);

  useEffect(() => {
    // Stagger entry animations
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    memories.forEach((m, i) => {
      timeouts.push(setTimeout(() => {
        setVisible((prev) => new Set([...prev, m.id]));
      }, i * 50));
    });
    return () => timeouts.forEach(clearTimeout);
  }, [memories]);

  if (!memories.length) {
    return (
      <div style={{
        padding: '40px 16px',
        color: 'var(--text-faint)',
        fontSize: 11,
        textAlign: 'center',
        lineHeight: 1.8,
      }}>
        No recent activity.
        <br />
        <span style={{ fontSize: 10 }}>Memories appear here as the agent stores them.</span>
      </div>
    );
  }

  return (
    <div style={{ maxHeight: 420, overflow: 'auto' }}>
      {memories.map((m) => {
        const color = TYPE_COLORS[m.memory_type] || '#666';
        const isRecent = Date.now() - new Date(m.created_at).getTime() < 3600000;
        const isNew = newIds.has(m.id);
        return (
          <div
            key={m.id}
            className={isNew ? 'new-memory-highlight' : ''}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '8px 14px',
              borderBottom: '1px solid var(--border)',
              opacity: visible.has(m.id) ? 1 : 0,
              transform: visible.has(m.id) ? 'translateX(0)' : 'translateX(-12px)',
              transition: 'all 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{
              width: 5, height: 5, borderRadius: '50%',
              background: color,
              marginTop: 6, flexShrink: 0,
              boxShadow: isRecent ? `0 0 6px ${color}60` : 'none',
              animation: isRecent ? 'pulse-glow 2s ease-in-out infinite' : 'none',
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11, lineHeight: 1.5,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {m.summary}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', marginTop: 2 }}>
                <span style={{
                  color,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  fontWeight: 600,
                }}>
                  {m.memory_type.replace('_', ' ')}
                </span>
                <span style={{ margin: '0 4px', opacity: 0.4 }}>/</span>
                {relativeTime(m.created_at)}
                {m.importance >= 0.7 && (
                  <span style={{ marginLeft: 6, color: 'var(--self-model)', fontWeight: 600 }}>
                    high
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
