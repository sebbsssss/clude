/**
 * Entity extraction and memory connections.
 * 
 * Connections form a local knowledge graph between memories.
 * They travel with memories during export/import (portable).
 * 
 * Connection types:
 *   supports     — memory reinforces another
 *   contradicts  — memory conflicts with another
 *   elaborates   — memory adds detail to another
 *   causes       — one event led to another
 *   follows      — temporal sequence
 *   co_mentioned — share entities
 *   derived      — consolidation product
 *   similar      — semantically close (auto-detected)
 */

import Database from 'better-sqlite3';
import type { Connection, ConnectionType } from './identity.js';

export class ConnectionStore {
  constructor(private db: Database.Database) {
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_memory_id INTEGER NOT NULL,
        to_memory_id INTEGER NOT NULL,
        from_uuid TEXT,
        to_uuid TEXT,
        type TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(from_memory_id, to_memory_id, type)
      );
      CREATE INDEX IF NOT EXISTS idx_conn_from ON connections(from_memory_id);
      CREATE INDEX IF NOT EXISTS idx_conn_to ON connections(to_memory_id);
      CREATE INDEX IF NOT EXISTS idx_conn_type ON connections(type);
      CREATE INDEX IF NOT EXISTS idx_conn_uuid_from ON connections(from_uuid);
      CREATE INDEX IF NOT EXISTS idx_conn_uuid_to ON connections(to_uuid);
    `);
  }

  /**
   * Create a connection between two memories.
   */
  connect(
    fromId: number,
    toId: number,
    type: ConnectionType,
    strength = 0.5,
    fromUuid?: string,
    toUuid?: string,
  ): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO connections (from_memory_id, to_memory_id, from_uuid, to_uuid, type, strength)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(fromId, toId, fromUuid || null, toUuid || null, type, strength);
  }

  /**
   * Get all connections for a memory (both directions).
   */
  getConnections(memoryId: number): Array<{
    memory_id: number;
    direction: 'outgoing' | 'incoming';
    type: ConnectionType;
    strength: number;
    uuid?: string;
  }> {
    const outgoing = this.db.prepare(
      'SELECT to_memory_id as memory_id, to_uuid as uuid, type, strength FROM connections WHERE from_memory_id = ?'
    ).all(memoryId) as any[];
    
    const incoming = this.db.prepare(
      'SELECT from_memory_id as memory_id, from_uuid as uuid, type, strength FROM connections WHERE to_memory_id = ?'
    ).all(memoryId) as any[];

    return [
      ...outgoing.map((r: any) => ({ ...r, direction: 'outgoing' as const })),
      ...incoming.map((r: any) => ({ ...r, direction: 'incoming' as const })),
    ];
  }

  /**
   * Get connected memory IDs with weighted scores.
   * Used during recall to boost memories connected to high-similarity results.
   */
  getConnectedIds(memoryIds: number[]): Map<number, { totalWeight: number; types: ConnectionType[] }> {
    if (memoryIds.length === 0) return new Map();

    const placeholders = memoryIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT to_memory_id as id, type, strength FROM connections 
      WHERE from_memory_id IN (${placeholders})
      UNION
      SELECT from_memory_id as id, type, strength FROM connections 
      WHERE to_memory_id IN (${placeholders})
    `).all(...memoryIds, ...memoryIds) as any[];

    const result = new Map<number, { totalWeight: number; types: ConnectionType[] }>();
    for (const row of rows) {
      if (memoryIds.includes(row.id)) continue; // skip self-references
      const existing = result.get(row.id);
      if (existing) {
        existing.totalWeight += row.strength * connectionTypeWeight(row.type);
        if (!existing.types.includes(row.type)) existing.types.push(row.type);
      } else {
        result.set(row.id, {
          totalWeight: row.strength * connectionTypeWeight(row.type),
          types: [row.type],
        });
      }
    }
    return result;
  }

  /**
   * Auto-detect similar memories and create connections.
   * Call after storing a batch of memories.
   */
  autoConnect(memoryId: number, similarIds: Array<{ id: number; similarity: number }>, uuid?: string): void {
    for (const { id, similarity } of similarIds) {
      if (id === memoryId) continue;
      if (similarity > 0.85) {
        // Get the target UUID if we have it
        const targetUuid = this.db.prepare(
          'SELECT to_uuid FROM connections WHERE to_memory_id = ? LIMIT 1'
        ).get(id) as any;
        
        this.connect(memoryId, id, 'similar', similarity, uuid, targetUuid?.to_uuid);
      }
    }
  }

  /**
   * Export all connections as portable format (using UUIDs).
   */
  exportConnections(): Connection[] {
    const rows = this.db.prepare(
      'SELECT from_uuid, to_uuid, type, strength, created_at FROM connections WHERE from_uuid IS NOT NULL AND to_uuid IS NOT NULL'
    ).all() as any[];

    return rows.map(r => ({
      from_uuid: r.from_uuid,
      to_uuid: r.to_uuid,
      type: r.type as ConnectionType,
      strength: r.strength,
      created_at: r.created_at,
    }));
  }

  /**
   * Import connections from a memory pack.
   * Requires a UUID → local ID mapping (built during memory import).
   */
  importConnections(connections: Connection[], uuidToId: Map<string, number>): number {
    let imported = 0;
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO connections (from_memory_id, to_memory_id, from_uuid, to_uuid, type, strength, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const conn of connections) {
      const fromId = uuidToId.get(conn.from_uuid);
      const toId = uuidToId.get(conn.to_uuid);
      if (!fromId || !toId) continue;
      stmt.run(fromId, toId, conn.from_uuid, conn.to_uuid, conn.type, conn.strength, conn.created_at);
      imported++;
    }
    return imported;
  }

  /** Count connections */
  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as n FROM connections').get() as any;
    return row.n;
  }

  /** Clear all connections */
  clear(): void {
    this.db.exec('DELETE FROM connections');
  }
}

// ── Weights per connection type (used in recall boost) ──

const CONNECTION_WEIGHTS: Record<ConnectionType, number> = {
  supports: 1.2,
  contradicts: 0.8,    // still relevant, but might conflict
  elaborates: 1.5,     // high value — adds detail
  causes: 1.3,
  follows: 1.0,
  co_mentioned: 0.7,
  derived: 1.1,
  similar: 0.9,
};

function connectionTypeWeight(type: ConnectionType): number {
  return CONNECTION_WEIGHTS[type] || 1.0;
}
