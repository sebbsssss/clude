/**
 * Static validation of 038_title_transfers_unique.sql — the title_transfers audit unique index.
 * A stateless session cannot apply SQL, so (like the 037 test) this parses the file and asserts the
 * index is present, idempotent, and keyed (pack_id, to_wallet, tx) so re-buys are not blocked.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const FILE = path.resolve(__dirname, '../../../../../packages/database/migrations/038_title_transfers_unique.sql');
const read = () => readFileSync(FILE, 'utf8');
const norm = (s: string) => s.replace(/\s+/g, ' ');

describe('038_title_transfers_unique.sql', () => {
  it('is a numbered, transactional migration', () => {
    const sql = read();
    expect(sql).toMatch(/^--\s*038[_:]/);
    expect(sql).toMatch(/^\s*--[\s\S]*?\bBEGIN;/);
    expect(sql).toMatch(/\bCOMMIT;\s*$/);
  });

  it('creates an idempotent UNIQUE index on title_transfers(pack_id, to_wallet, tx)', () => {
    expect(norm(read())).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_title_transfers_pack_to_tx ON title_transfers\(pack_id, to_wallet, tx\)/i,
    );
  });

  it('does NOT recreate any table (purely additive)', () => {
    expect(read()).not.toMatch(/CREATE TABLE/i);
  });
});
