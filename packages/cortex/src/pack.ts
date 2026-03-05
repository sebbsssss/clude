// ============================================================
// MEMORY PACKS — Portable, signed memory bundles
//
// A MemoryPack is a self-contained bundle of memories that can
// be exported, signed, shared, and imported by any agent.
//
// Like a Git commit for memory:
//   - Content hash ensures integrity
//   - Signature proves ownership
//   - UUIDs enable merge deduplication
//   - Connections travel with memories
// ============================================================

import { createHash, createHmac } from 'crypto';
import { generateMemoryUUID } from './identity.js';

// ── Types ────────────────────────────────────────────────────

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model';

export type ConnectionType =
  | 'supports' | 'contradicts' | 'elaborates' | 'causes'
  | 'follows' | 'co_mentioned' | 'derived' | 'similar';

export interface PortableMemory {
  uuid: string;
  content: string;
  summary: string;
  type: MemoryType;
  importance: number;
  tags: string[];
  created_at: string;
  access_count: number;
  decay_factor: number;
  source_wallet: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface PortableConnection {
  from_uuid: string;
  to_uuid: string;
  type: ConnectionType;
  strength: number;
  created_at: string;
}

export interface PortableEntity {
  name: string;
  entity_type: string;
  aliases: string[];
  description?: string;
  mention_count: number;
  /** UUIDs of memories mentioning this entity */
  memory_uuids: string[];
}

export interface PortableRelation {
  source_entity: string;   // entity name
  target_entity: string;
  relation_type: string;
  strength: number;
  evidence_uuids: string[];
}

export interface MemoryPack {
  version: 1;
  format: 'clude-pack';
  wallet: string;
  identity: {
    wallet: string;
    name?: string;
    description?: string;
  };
  memories: PortableMemory[];
  connections: PortableConnection[];
  entities: PortableEntity[];
  relations: PortableRelation[];
  meta: {
    exported_at: string;
    memory_count: number;
    connection_count: number;
    entity_count: number;
    content_hash: string;
    /** HMAC-SHA256 (local) or Solana Ed25519 signature */
    signature?: string;
    signature_type?: 'hmac-sha256' | 'ed25519';
    /** Solana transaction ID if committed on-chain */
    solana_tx?: string;
  };
}

// ── Pack Operations ──────────────────────────────────────────

/**
 * Compute deterministic content hash for integrity verification.
 */
export function computeContentHash(memories: PortableMemory[]): string {
  const sorted = [...memories].sort((a, b) => a.uuid.localeCompare(b.uuid));
  const json = JSON.stringify(sorted.map(m => ({
    uuid: m.uuid, content: m.content, type: m.type, source_wallet: m.source_wallet,
  })));
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Sign a pack with HMAC-SHA256 (local mode).
 * For production Solana signing, use @clude/cortex/solana.
 */
export function signPackHMAC(contentHash: string, secret: string): string {
  return createHmac('sha256', secret).update(contentHash).digest('hex');
}

/**
 * Verify a pack's content integrity (hash matches memories).
 */
export function verifyPackIntegrity(pack: MemoryPack): boolean {
  const computed = computeContentHash(pack.memories);
  return computed === pack.meta.content_hash;
}

/**
 * Verify HMAC signature on a pack.
 */
export function verifyPackHMAC(pack: MemoryPack, secret: string): boolean {
  if (!pack.meta.signature || pack.meta.signature_type !== 'hmac-sha256') return false;
  const expected = signPackHMAC(pack.meta.content_hash, secret);
  return expected === pack.meta.signature;
}

/**
 * Create a MemoryPack from raw data.
 */
export function createPack(opts: {
  wallet: string;
  name?: string;
  description?: string;
  memories: PortableMemory[];
  connections?: PortableConnection[];
  entities?: PortableEntity[];
  relations?: PortableRelation[];
  secret?: string;
}): MemoryPack {
  const contentHash = computeContentHash(opts.memories);
  const signature = opts.secret ? signPackHMAC(contentHash, opts.secret) : undefined;

  return {
    version: 1,
    format: 'clude-pack',
    wallet: opts.wallet,
    identity: { wallet: opts.wallet, name: opts.name, description: opts.description },
    memories: opts.memories,
    connections: opts.connections ?? [],
    entities: opts.entities ?? [],
    relations: opts.relations ?? [],
    meta: {
      exported_at: new Date().toISOString(),
      memory_count: opts.memories.length,
      connection_count: opts.connections?.length ?? 0,
      entity_count: opts.entities?.length ?? 0,
      content_hash: contentHash,
      signature,
      signature_type: signature ? 'hmac-sha256' : undefined,
    },
  };
}

/**
 * Merge two MemoryPacks. Deduplicates by UUID.
 * Returns a new pack with combined memories, connections, entities.
 */
export function mergePacks(a: MemoryPack, b: MemoryPack, opts?: { wallet?: string; secret?: string }): MemoryPack {
  const seenUUIDs = new Set<string>();
  const memories: PortableMemory[] = [];

  for (const mem of [...a.memories, ...b.memories]) {
    if (!seenUUIDs.has(mem.uuid)) {
      memories.push(mem);
      seenUUIDs.add(mem.uuid);
    }
  }

  // Merge connections (dedup by from+to+type)
  const connKey = (c: PortableConnection) => `${c.from_uuid}:${c.to_uuid}:${c.type}`;
  const connMap = new Map<string, PortableConnection>();
  for (const c of [...a.connections, ...b.connections]) {
    const key = connKey(c);
    const existing = connMap.get(key);
    if (!existing || c.strength > existing.strength) connMap.set(key, c);
  }

  // Merge entities (dedup by name)
  const entityMap = new Map<string, PortableEntity>();
  for (const e of [...a.entities, ...b.entities]) {
    const existing = entityMap.get(e.name);
    if (existing) {
      existing.mention_count = Math.max(existing.mention_count, e.mention_count);
      existing.memory_uuids = [...new Set([...existing.memory_uuids, ...e.memory_uuids])];
    } else {
      entityMap.set(e.name, { ...e });
    }
  }

  // Merge relations (dedup by src+tgt+type)
  const relKey = (r: PortableRelation) => `${r.source_entity}:${r.target_entity}:${r.relation_type}`;
  const relMap = new Map<string, PortableRelation>();
  for (const r of [...a.relations, ...b.relations]) {
    const key = relKey(r);
    const existing = relMap.get(key);
    if (!existing || r.strength > existing.strength) relMap.set(key, r);
  }

  return createPack({
    wallet: opts?.wallet ?? a.wallet,
    memories,
    connections: [...connMap.values()],
    entities: [...entityMap.values()],
    relations: [...relMap.values()],
    secret: opts?.secret,
  });
}

/**
 * Export a MemoryPack as human-readable markdown.
 */
export function packToMarkdown(pack: MemoryPack): string {
  let md = `# Memory Pack: ${pack.identity.name || pack.wallet}\n`;
  md += `> Wallet: \`${pack.wallet}\`\n`;
  md += `> Exported: ${pack.meta.exported_at}\n`;
  md += `> Memories: ${pack.meta.memory_count} | Connections: ${pack.meta.connection_count} | Entities: ${pack.meta.entity_count}\n`;
  if (pack.meta.signature) md += `> Signed: ${pack.meta.signature_type}\n`;
  if (pack.meta.solana_tx) md += `> On-chain: [${pack.meta.solana_tx.slice(0, 16)}...](https://solscan.io/tx/${pack.meta.solana_tx})\n`;
  md += '\n';

  // Group by type
  const byType: Record<string, PortableMemory[]> = {};
  for (const m of pack.memories) (byType[m.type] = byType[m.type] || []).push(m);

  for (const [type, mems] of Object.entries(byType)) {
    md += `## ${type} (${mems.length})\n\n`;
    for (const m of mems) {
      md += `- **[${m.uuid.slice(0, 8)}]** (imp=${m.importance.toFixed(1)}) ${m.summary}\n`;
    }
    md += '\n';
  }

  if (pack.entities.length > 0) {
    md += `## Entities (${pack.entities.length})\n\n`;
    for (const e of pack.entities) {
      md += `- **${e.name}** (${e.entity_type}, ${e.mention_count} mentions)\n`;
    }
    md += '\n';
  }

  if (pack.connections.length > 0) {
    md += `## Connections (${pack.connections.length})\n\n`;
    for (const c of pack.connections) {
      md += `- ${c.from_uuid.slice(0, 8)} --[${c.type} ${c.strength.toFixed(1)}]--> ${c.to_uuid.slice(0, 8)}\n`;
    }
  }

  return md;
}

/**
 * Export a MemoryPack as JSON string (pretty-printed).
 */
export function packToJSON(pack: MemoryPack): string {
  return JSON.stringify(pack, null, 2);
}

/**
 * Parse a MemoryPack from JSON string.
 */
export function packFromJSON(json: string): MemoryPack {
  const pack = JSON.parse(json) as MemoryPack;
  if (pack.version !== 1 || pack.format !== 'clude-pack') {
    throw new Error(`Unsupported pack format: v${pack.version} ${pack.format}`);
  }
  return pack;
}
