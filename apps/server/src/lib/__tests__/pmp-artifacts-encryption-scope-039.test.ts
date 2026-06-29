/**
 * Regression test for migration 039_pmp_artifacts_encryption_scope_owner.sql.
 *
 * The bug: 033 declared `encryption_scope CHECK (... IN ('none','records','records+blobs'))`, but the
 * live code only ever writes 'none' (plaintext), 'owner' (owner-sealed encrypted export), and 'pack'
 * (title snapshot). So every ENCRYPTED export's INSERT failed the CHECK (SQLSTATE 23514) and the route
 * returned 500 export_failed. Unit tests mock the DB so the real CHECK was never exercised; every
 * prod/preview verification was unauthenticated and never reached the INSERT.
 *
 * 039 widens the constraint to the values the code writes. This guard asserts that EVERY encryption_scope
 * value the server actually writes is permitted by the migration, so the code↔constraint drift can't
 * silently return. It reads the migration file (no DB), so it would fail outright before 039 existed.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../../packages/database/migrations');
const FILE_039 = path.join(MIGRATIONS_DIR, '039_pmp_artifacts_encryption_scope_owner.sql');

/** Every encryption_scope value written anywhere in apps/server (the constraint MUST allow each). */
const WRITTEN_SCOPES = ['none', 'owner', 'pack'] as const;

function read039(): string {
  return readFileSync(FILE_039, 'utf8');
}

/** Collapse whitespace so multi-line DDL matches with simple substrings. */
function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ');
}

describe('039_pmp_artifacts_encryption_scope_owner.sql — house style', () => {
  it('has a numbered header comment and is wrapped in a single transaction', () => {
    const sql = read039();
    expect(sql, 'must start with a numbered header comment').toMatch(/^--\s*039[_:]/);
    expect(sql, 'must open BEGIN;').toMatch(/\bBEGIN;/);
    expect(sql, 'must end COMMIT;').toMatch(/\bCOMMIT;\s*$/);
  });

  it('drops the old constraint with IF EXISTS (idempotent re-run)', () => {
    expect(normalize(read039())).toMatch(
      /ALTER TABLE pmp_artifacts DROP CONSTRAINT IF EXISTS pmp_artifacts_encryption_scope_check/i,
    );
  });
});

describe('039 — encryption_scope CHECK admits every value the code writes', () => {
  it('widens the CHECK to include owner + pack (the values 033 omitted)', () => {
    const sql = normalize(read039());
    // The widened CHECK must be present and additive (keeps the old set, adds the live values).
    expect(sql).toMatch(/ADD CONSTRAINT pmp_artifacts_encryption_scope_check\s+CHECK\s*\(\s*encryption_scope\s+IN\s*\(/i);
    for (const scope of [...WRITTEN_SCOPES, 'records', 'records+blobs']) {
      expect(sql, `migration 039 must allow encryption_scope '${scope}'`).toContain(`'${scope}'`);
    }
  });

  it('REGRESSION: each scope the server writes (none/owner/pack) is permitted', () => {
    // Extract the IN (...) list from the ADD CONSTRAINT specifically (NOT the header comment, which
    // quotes the OLD set). This fails the moment code writes a scope the constraint forbids — exactly
    // the bug that 500'd the export.
    const sql = normalize(read039());
    const m = sql.match(
      /ADD CONSTRAINT pmp_artifacts_encryption_scope_check\s+CHECK\s*\(\s*encryption_scope\s+IN\s*\(([^)]*)\)/i,
    );
    expect(m, 'could not find the ADD CONSTRAINT encryption_scope IN (...) list in 039').not.toBeNull();
    const allowed = (m![1].match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
    for (const scope of WRITTEN_SCOPES) {
      expect(allowed, `the export/title code writes '${scope}' — the CHECK must allow it`).toContain(scope);
    }
  });
});
