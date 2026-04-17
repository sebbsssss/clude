// packages/brain/src/storage/__tests__/schema.test.ts

import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDatabase, CURRENT_SCHEMA_VERSION } from '../schema';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('schema', () => {
  let db: Database.Database;

  afterEach(() => {
    if (db) db.close();
  });

  it('creates all tables on fresh database', () => {
    db = new Database(':memory:');
    initDatabase(db);

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r: any) => r.name);

    expect(tables).toContain('memories');
    expect(tables).toContain('links');
    expect(tables).toContain('dream_queue');
    expect(tables).toContain('schema_version');
  });

  it('sets correct pragmas', () => {
    // WAL mode requires a file-backed database; :memory: only supports 'memory' journal mode
    const dir = mkdtempSync(join(tmpdir(), 'clude-schema-test-'));
    const dbPath = join(dir, 'test.db');
    const fileDb = new Database(dbPath);
    try {
      initDatabase(fileDb);
      const journalMode = fileDb.pragma('journal_mode', { simple: true });
      expect(journalMode).toBe('wal');
    } finally {
      fileDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records schema version', () => {
    db = new Database(':memory:');
    initDatabase(db);

    const version = db.prepare(
      'SELECT MAX(version) as v FROM schema_version'
    ).get() as any;
    expect(version.v).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('is idempotent — running twice does not error', () => {
    db = new Database(':memory:');
    initDatabase(db);
    expect(() => initDatabase(db)).not.toThrow();
  });
});
