// packages/brain/src/storage/schema.ts

import type Database from 'better-sqlite3';

export const CURRENT_SCHEMA_VERSION = 1;

export function initDatabase(db: Database.Database): void {
  // Pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('cache_size = -64000');

  // Check if already initialized
  const hasVersionTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();

  if (hasVersionTable) {
    const current = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as any;
    if (current?.v >= CURRENT_SCHEMA_VERSION) return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      memory_type TEXT NOT NULL CHECK(memory_type IN (
        'episodic','semantic','procedural','self_model','introspective'
      )),
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0.5,
      decay_factor REAL NOT NULL DEFAULT 1.0,
      emotional_valence REAL DEFAULT 0.0,
      tags TEXT DEFAULT '[]',
      concepts TEXT DEFAULT '[]',
      source TEXT DEFAULT 'mcp',
      source_id TEXT,
      related_user TEXT,
      related_wallet TEXT,
      owner TEXT,
      metadata TEXT DEFAULT '{}',
      access_count INTEGER DEFAULT 0,
      compacted INTEGER DEFAULT 0,
      compacted_into TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      last_accessed TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      cloud_synced INTEGER DEFAULT 0,
      cloud_id TEXT,
      embedding_model TEXT DEFAULT 'all-MiniLM-L6-v2'
    );

    CREATE TABLE IF NOT EXISTS links (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      bond_type TEXT NOT NULL CHECK(bond_type IN (
        'causes','supports','resolves','elaborates','contradicts'
      )),
      strength REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (source_id, target_id, bond_type)
    );

    CREATE TABLE IF NOT EXISTS dream_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation TEXT NOT NULL CHECK(operation IN (
        'consolidate','compact','reflect','resolve_contradiction','emergence'
      )),
      memory_ids TEXT NOT NULL DEFAULT '[]',
      priority REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
        'pending','processing','completed','failed'
      )),
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
    CREATE INDEX IF NOT EXISTS idx_memories_owner ON memories(owner);
    CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_cloud_synced ON memories(cloud_synced);
    CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
    CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);
    CREATE INDEX IF NOT EXISTS idx_dream_queue_status ON dream_queue(status, priority DESC);
  `);

  db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(CURRENT_SCHEMA_VERSION);
}
