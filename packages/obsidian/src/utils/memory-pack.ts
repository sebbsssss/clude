import { CludeEngineAdapter, Memory, MemoryType, StoreOptions } from '../engine-adapter';
import { CludeSettings } from '../settings';

// ============================================================
// MEMORY PACK TYPES (based on @clude/cortex)
// ============================================================

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
  type: string;
  strength: number;
  created_at: string;
}

export interface PortableEntity {
  name: string;
  entity_type: string;
  aliases: string[];
  description?: string;
  mention_count: number;
  memory_uuids: string[];
}

export interface PortableRelation {
  source_entity: string;
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
    signature?: string;
    signature_type?: 'hmac-sha256' | 'ed25519';
    solana_tx?: string;
  };
}

// ============================================================
// EXPORT FUNCTIONS
// ============================================================

export async function exportMemoryPack(
  engine: CludeEngineAdapter,
  settings: CludeSettings
): Promise<MemoryPack> {
  const memories = engine.getAllMemories();
  const portableMemories: PortableMemory[] = [];
  const connections: PortableConnection[] = [];
  const entityMap = new Map<string, PortableEntity>();

  // Convert memories to portable format
  for (const memory of memories) {
    const uuid = generateUUID(memory);
    
    const portableMemory: PortableMemory = {
      uuid,
      content: memory.content,
      summary: memory.summary,
      type: memory.memory_type,
      importance: memory.importance,
      tags: memory.tags,
      created_at: memory.created_at,
      access_count: memory.access_count,
      decay_factor: memory.decay_factor,
      source_wallet: getWalletId(settings),
      source: memory.source,
      metadata: memory.metadata
    };

    portableMemories.push(portableMemory);

    // Extract entities from this memory
    extractEntitiesForPack(memory, uuid, entityMap);

    // Get connections for this memory
    const links = await engine.getLinks(memory.id);
    for (const link of links) {
      const targetMemory = await engine.getById(link.target_id);
      if (targetMemory) {
        const targetUuid = generateUUID(targetMemory);
        connections.push({
          from_uuid: uuid,
          to_uuid: targetUuid,
          type: link.link_type,
          strength: link.strength,
          created_at: new Date().toISOString()
        });
      }
    }
  }

  // Build entity relations
  const relations = buildEntityRelations(entityMap, portableMemories);

  // Compute content hash
  const contentHash = await computeContentHash(portableMemories);

  const pack: MemoryPack = {
    version: 1,
    format: 'clude-pack',
    wallet: getWalletId(settings),
    identity: {
      wallet: getWalletId(settings),
      name: 'Obsidian Vault',
      description: 'Exported memories from Obsidian via Clude plugin'
    },
    memories: portableMemories,
    connections,
    entities: Array.from(entityMap.values()),
    relations,
    meta: {
      exported_at: new Date().toISOString(),
      memory_count: portableMemories.length,
      connection_count: connections.length,
      entity_count: entityMap.size,
      content_hash: contentHash
    }
  };

  return pack;
}

// ============================================================
// IMPORT FUNCTIONS
// ============================================================

export async function importMemoryPack(
  packJson: string,
  engine: CludeEngineAdapter
): Promise<number> {
  let pack: MemoryPack;
  
  try {
    pack = JSON.parse(packJson);
  } catch (error) {
    throw new Error('Invalid JSON format');
  }

  // Validate pack format
  if (pack.version !== 1 || pack.format !== 'clude-pack') {
    throw new Error(`Unsupported pack format: v${pack.version} ${pack.format}`);
  }

  // Verify content integrity
  const computedHash = await computeContentHash(pack.memories);
  if (computedHash !== pack.meta.content_hash) {
    console.warn('Content hash mismatch - pack may be corrupted');
  }

  let importedCount = 0;
  const uuidMap = new Map<string, string>(); // Original UUID -> New internal ID

  // Import memories
  for (const portableMemory of pack.memories) {
    try {
      const storeOptions: StoreOptions = {
        type: portableMemory.type,
        content: portableMemory.content,
        summary: portableMemory.summary,
        tags: portableMemory.tags,
        importance: portableMemory.importance,
        source: `import-${pack.format}`,
        metadata: {
          ...portableMemory.metadata,
          original_uuid: portableMemory.uuid,
          imported_from: pack.identity.name || pack.wallet,
          imported_at: new Date().toISOString(),
          original_created_at: portableMemory.created_at,
          original_access_count: portableMemory.access_count,
          original_decay_factor: portableMemory.decay_factor
        }
      };

      const memory = await engine.store(storeOptions);
      uuidMap.set(portableMemory.uuid, memory.id);
      importedCount++;
    } catch (error) {
      console.error('Failed to import memory:', portableMemory.uuid, error);
    }
  }

  // TODO: Import connections (would need engine support for creating links)
  // This would require extending the engine adapter to support creating custom links

  return importedCount;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function generateUUID(memory: Memory): string {
  // Generate a deterministic UUID based on content and timestamp
  // This is a simplified version - in production you'd use proper UUID generation
  const content = memory.content + memory.created_at + memory.source_id;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  // Convert to positive hex string
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-${hex.slice(15, 19)}-${hex.slice(19, 31)}`;
}

function getWalletId(settings: CludeSettings): string {
  // Generate a wallet-like ID for this Obsidian instance
  // In a real implementation, this might be user-configurable or derived from device ID
  if (settings.cloudMode && settings.cloudApiKey) {
    return settings.cloudApiKey.split('_')[1]?.slice(0, 8) || 'obsidian';
  }
  
  // Generate pseudo-wallet from hostname/user
  const platform = typeof window !== 'undefined' ? 'web' : 'desktop';
  return `obsidian-${platform}-${Date.now().toString(36).slice(-6)}`;
}

function extractEntitiesForPack(
  memory: Memory,
  uuid: string,
  entityMap: Map<string, PortableEntity>
): void {
  // Extract entities from tags and concepts
  const allEntities = [...memory.tags, ...memory.concepts];
  
  allEntities.forEach(entityName => {
    let entity = entityMap.get(entityName);
    if (!entity) {
      entity = {
        name: entityName,
        entity_type: inferEntityType(entityName, memory),
        aliases: [],
        mention_count: 0,
        memory_uuids: []
      };
      entityMap.set(entityName, entity);
    }
    
    entity.mention_count++;
    if (!entity.memory_uuids.includes(uuid)) {
      entity.memory_uuids.push(uuid);
    }
  });

  // Extract mentioned entities from content
  const mentionRegex = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
  const mentions = memory.content.match(mentionRegex) || [];
  
  mentions.forEach(mention => {
    if (mention.length > 2 && mention.length < 30) {
      let entity = entityMap.get(mention);
      if (!entity) {
        entity = {
          name: mention,
          entity_type: 'person', // Default assumption for capitalized words
          aliases: [],
          mention_count: 0,
          memory_uuids: []
        };
        entityMap.set(mention, entity);
      }
      
      entity.mention_count++;
      if (!entity.memory_uuids.includes(uuid)) {
        entity.memory_uuids.push(uuid);
      }
    }
  });
}

function inferEntityType(entityName: string, memory: Memory): string {
  const name = entityName.toLowerCase();
  
  // Check for common patterns
  if (name.includes('project') || name.includes('app') || name.includes('system')) {
    return 'project';
  }
  
  if (name.includes('concept') || name.includes('idea') || name.includes('theory')) {
    return 'concept';
  }
  
  if (name.includes('place') || name.includes('location') || name.includes('city')) {
    return 'location';
  }
  
  // Check memory type context
  if (memory.memory_type === 'episodic') {
    return 'event';
  }
  
  if (memory.memory_type === 'procedural') {
    return 'concept';
  }
  
  // Default to person for capitalized words
  if (/^[A-Z][a-z]+$/.test(entityName)) {
    return 'person';
  }
  
  return 'concept';
}

function buildEntityRelations(
  entityMap: Map<string, PortableEntity>,
  memories: PortableMemory[]
): PortableRelation[] {
  const relations: PortableRelation[] = [];
  const relationMap = new Map<string, PortableRelation>();

  // Build co-mention relationships
  memories.forEach(memory => {
    const memoryEntities = Array.from(entityMap.values())
      .filter(entity => entity.memory_uuids.includes(memory.uuid))
      .map(entity => entity.name);

    // Create co-mention relations
    for (let i = 0; i < memoryEntities.length; i++) {
      for (let j = i + 1; j < memoryEntities.length; j++) {
        const source = memoryEntities[i];
        const target = memoryEntities[j];
        const relationKey = `${source}:${target}:co_mentioned`;
        
        let relation = relationMap.get(relationKey);
        if (!relation) {
          relation = {
            source_entity: source,
            target_entity: target,
            relation_type: 'co_mentioned',
            strength: 0,
            evidence_uuids: []
          };
          relationMap.set(relationKey, relation);
        }
        
        relation.strength += 0.1; // Increment strength for each co-mention
        if (!relation.evidence_uuids.includes(memory.uuid)) {
          relation.evidence_uuids.push(memory.uuid);
        }
      }
    }
  });

  // Normalize strength values
  relationMap.forEach(relation => {
    relation.strength = Math.min(relation.strength, 1.0);
    if (relation.strength >= 0.2) { // Only include relations above threshold
      relations.push(relation);
    }
  });

  return relations;
}

async function computeContentHash(memories: PortableMemory[]): Promise<string> {
  // Sort memories by UUID for deterministic hashing
  const sortedMemories = [...memories].sort((a, b) => a.uuid.localeCompare(b.uuid));
  
  // Create hash input from core memory content
  const hashInput = sortedMemories.map(m => ({
    uuid: m.uuid,
    content: m.content,
    type: m.type,
    source_wallet: m.source_wallet
  }));

  const jsonString = JSON.stringify(hashInput);
  
  // Simple hash function (in production, use crypto.subtle or similar)
  let hash = 0;
  for (let i = 0; i < jsonString.length; i++) {
    const char = jsonString.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ============================================================
// VALIDATION
// ============================================================

export function validateMemoryPack(packJson: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  try {
    const pack = JSON.parse(packJson);
    
    // Check required fields
    if (!pack.version || pack.version !== 1) {
      errors.push('Invalid or missing version');
    }
    
    if (!pack.format || pack.format !== 'clude-pack') {
      errors.push('Invalid or missing format');
    }
    
    if (!pack.wallet) {
      errors.push('Missing wallet identifier');
    }
    
    if (!Array.isArray(pack.memories)) {
      errors.push('Memories must be an array');
    }
    
    if (!pack.meta || !pack.meta.content_hash) {
      errors.push('Missing metadata or content hash');
    }
    
    // Validate memory structure
    if (Array.isArray(pack.memories)) {
      pack.memories.forEach((memory: any, index: number) => {
        if (!memory.uuid) {
          errors.push(`Memory ${index}: missing UUID`);
        }
        if (!memory.content) {
          errors.push(`Memory ${index}: missing content`);
        }
        if (!memory.type || !['episodic', 'semantic', 'procedural', 'self_model'].includes(memory.type)) {
          errors.push(`Memory ${index}: invalid memory type`);
        }
      });
    }
    
  } catch (error) {
    errors.push('Invalid JSON format');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}