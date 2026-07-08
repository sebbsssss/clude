import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isTarballPath } from '../writer';

/**
 * Memory 3.0 B1: isTarballPath extensionless routing.
 *
 * Previously ANY existing file was routed through tarball extraction, so a
 * non-tarball died downstream with an opaque 'tar failed (exit)'. Now an
 * extensionless file must carry the zstd magic (28 B5 2F FD) to be routed;
 * a non-zstd file fails loudly at the routing decision instead.
 */

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mp-tarball-test-'));
  writeFileSync(join(dir, 'real.tar.zst'), Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00]));
  writeFileSync(join(dir, 'extensionless-zstd'), Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x02]));
  writeFileSync(join(dir, 'not-a-tarball'), Buffer.from('just some text'));
  writeFileSync(join(dir, 'tiny'), Buffer.from([0x28])); // shorter than the magic
  mkdirSync(join(dir, 'directory-pack'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isTarballPath', () => {
  it('accepts the canonical .tar.zst extension without touching the file', () => {
    expect(isTarballPath(join(dir, 'real.tar.zst'))).toBe(true);
    // Extension wins even if the path does not exist (create-new flows).
    expect(isTarballPath(join(dir, 'not-yet-written.tar.zst'))).toBe(true);
  });

  it('accepts an extensionless file that carries the zstd magic', () => {
    expect(isTarballPath(join(dir, 'extensionless-zstd'))).toBe(true);
  });

  it('REJECTS LOUDLY an extensionless file without the magic (no more opaque tar failure)', () => {
    expect(() => isTarballPath(join(dir, 'not-a-tarball'))).toThrow('bad magic');
    expect(() => isTarballPath(join(dir, 'tiny'))).toThrow('bad magic');
  });

  it('routes directories and nonexistent paths to directory-mode (false)', () => {
    expect(isTarballPath(join(dir, 'directory-pack'))).toBe(false);
    expect(isTarballPath(join(dir, 'does-not-exist'))).toBe(false);
  });
});
