/**
 * Guard: the Railway image must ship the `zstd` binary that .pmp tarball export depends on.
 *
 * writeMemoryPack tarball mode (packages/memorypack/src/writer.ts) shells out to `tar --zstd`,
 * which GNU tar implements by exec'ing the external `zstd` program. The runtime base image is
 * node:22-slim, which does NOT ship zstd by default. Without an explicit install, every
 * POST /v1/pmp/export 500s at the build step with "tar --zstd failed (exit 2): tar: zstd:
 * Cannot exec". CI runners happen to have zstd, and unit tests mock the DB, so nothing else
 * exercises this dependency — this guard ties it to a test so the image can't silently drop it.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const DOCKERFILE = path.resolve(__dirname, '../../../../../Dockerfile');

describe('Dockerfile ships the zstd binary required by .pmp tarball export', () => {
  it('apt-get installs zstd (tar --zstd in writeMemoryPack needs it)', () => {
    const df = readFileSync(DOCKERFILE, 'utf8');
    expect(df, 'Dockerfile must `apt-get install ... zstd` — tar --zstd in writeMemoryPack needs the zstd binary').toMatch(
      /apt-get install[^\n]*\bzstd\b/,
    );
  });
});
