// CLI tests — invoke the built dist/cli.js as a subprocess to exercise
// the actual binary that `npx @clude/memorypack verify` will run.
//
// Tests cover:
//   - --version prints the package version
//   - --help prints usage and exits 0
//   - bare invocation (no args) prints help and exits 1
//   - `verify <good-pack>` exits 0 with "Pack is valid"
//   - `verify <tampered-pack>` exits 1 with "REJECTED"
//   - `verify <encrypted-pack> --decrypt-key ...` decrypts inline
//   - unknown command exits 1
//   - parseArgs is unit-testable via the named export

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import nacl from 'tweetnacl';
// @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop
import * as bs58Module from 'bs58';
const bs58: { encode: (b: Uint8Array) => string; decode: (s: string) => Uint8Array } =
  (bs58Module as any).default || bs58Module;

import { parseArgs } from '../cli.js';
import { writeMemoryPack } from '../writer.js';
import type { MemoryPackRecord } from '../types.js';

// dist/cli.js path — vitest runs from the package root, so this is stable.
const CLI = resolve(__dirname, '..', '..', 'dist', 'cli.js');

// Force NO_COLOR so subprocess output is grep-able without ANSI escapes.
const ENV = { ...process.env, NO_COLOR: '1' };

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [CLI, ...args], {
    env: ENV,
    encoding: 'utf-8',
  });
  return {
    code: r.status ?? -1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mp-cli-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

beforeAll(() => {
  if (!existsSync(CLI)) {
    throw new Error(
      `CLI test prerequisites missing: ${CLI} does not exist. Run \`pnpm build\` in packages/memorypack/ first.`,
    );
  }
});

// ────────────────────────────────────────────────────────────────────
// Pure unit tests on parseArgs
// ────────────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  it('defaults to help when no args', () => {
    expect(parseArgs([])).toMatchObject({ command: 'help' });
  });
  it('--version sets command=version', () => {
    expect(parseArgs(['--version'])).toMatchObject({ command: 'version' });
    expect(parseArgs(['-v'])).toMatchObject({ command: 'version' });
  });
  it('verify <path> sets command + path', () => {
    const args = parseArgs(['verify', '/tmp/x']);
    expect(args.command).toBe('verify');
    expect(args.path).toBe('/tmp/x');
  });
  it('flags parse correctly', () => {
    const args = parseArgs([
      'verify', '/tmp/x',
      '--strict-signatures',
      '--verify-chain',
      '--strict-chain',
      '--rpc-url', 'https://rpc.example',
      '--cluster', 'devnet',
      '--public-key', 'PK',
      '--decrypt-key', 'YWJj',
    ]);
    expect(args).toMatchObject({
      command: 'verify',
      path: '/tmp/x',
      strictSignatures: true,
      verifyChain: true,
      strictChain: true,
      rpcUrl: 'https://rpc.example',
      cluster: 'devnet',
      publicKey: 'PK',
      decryptKey: 'YWJj',
    });
  });
  it('unknown command throws', () => {
    expect(() => parseArgs(['nope'])).toThrow(/unknown command/i);
  });
  it('unknown flag throws', () => {
    expect(() => parseArgs(['verify', '/tmp/x', '--bogus'])).toThrow(/unknown argument/i);
  });
});

// ────────────────────────────────────────────────────────────────────
// Subprocess tests against dist/cli.js
// ────────────────────────────────────────────────────────────────────

describe('CLI subprocess — meta commands', () => {
  it('--version prints the package version, exit 0', () => {
    const r = runCli(['--version']);
    expect(r.code).toBe(0);
    // The version string should look like X.Y.Z
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('--help prints usage, exit 0', () => {
    const r = runCli(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
    expect(r.stdout).toMatch(/verify/);
  });

  it('bare invocation prints help, exit 0', () => {
    const r = runCli([]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });

  it('unknown command exits 1', () => {
    const r = runCli(['frobnicate']);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/unknown command/i);
  });

  it('verify with no path prints help, exit 1', () => {
    const r = runCli(['verify']);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/Usage:/);
  });
});

// Test pack synthesis helper
function synthSignedPack(target: string): { publicKey: string; secretKey: Uint8Array } {
  const kp = nacl.sign.keyPair();
  const publicKey = bs58.encode(kp.publicKey);
  const records: MemoryPackRecord[] = [
    { id: 'r1', created_at: '2026-04-28T00:00:00Z', kind: 'episodic', content: 'one', tags: ['t'], importance: 0.5, source: 'test' },
    { id: 'r2', created_at: '2026-04-28T00:01:00Z', kind: 'semantic', content: 'two', tags: ['t'], importance: 0.6, source: 'test' },
  ];
  writeMemoryPack(target, records, {
    producer: { name: 'cli-test', version: '0.0.1', public_key: publicKey },
    record_schema: 'cli-test-v1',
    secretKey: kp.secretKey,
    clock: () => '2026-04-28T00:00:00.000Z',
  });
  return { publicKey, secretKey: kp.secretKey };
}

describe('CLI subprocess — verify', () => {
  it('verify on a good pack exits 0 with "Pack is valid"', () => {
    synthSignedPack(dir);
    const r = runCli(['verify', dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Pack is valid/);
    expect(r.stdout).toMatch(/Signatures/);
    expect(r.stdout).toMatch(/verified:    2/);
  });

  it('verify on a tampered pack exits 1 with REJECTED', () => {
    synthSignedPack(dir);
    // Tamper records.jsonl
    const recordsPath = join(dir, 'records.jsonl');
    writeFileSync(
      recordsPath,
      readFileSync(recordsPath, 'utf-8').replace('"one"', '"oneX"'),
    );
    const r = runCli(['verify', dir]);
    expect(r.code).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/REJECTED/);
    expect(r.stderr + r.stdout).toMatch(/signature verification failed/i);
  });

  it('verify on encrypted pack with correct --decrypt-key succeeds', () => {
    const records: MemoryPackRecord[] = [
      { id: 'enc1', created_at: '2026-04-28T00:00:00Z', kind: 'episodic', content: 'secret', tags: [], importance: 0.5, source: 'test' },
    ];
    const key = new Uint8Array(32).fill(11);
    writeMemoryPack(dir, records, {
      producer: { name: 'enc-test', version: '0.0.1' },
      record_schema: 'cli-test-v1',
      encryption: { key, scope: 'records' },
      clock: () => '2026-04-28T00:00:00.000Z',
    });
    const r = runCli(['verify', dir, '--decrypt-key', Buffer.from(key).toString('base64')]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Encryption/);
    expect(r.stdout).toMatch(/decrypted:   1 of 1/);
  });

  it('verify with --strict-signatures on unsigned pack rejects', () => {
    const records: MemoryPackRecord[] = [
      { id: 'u1', created_at: '2026-04-28T00:00:00Z', kind: 'episodic', content: 'u', tags: [], importance: 0.5, source: 'test' },
    ];
    writeMemoryPack(dir, records, {
      producer: { name: 'unsigned', version: '0.0.1' },
      record_schema: 'cli-test-v1',
      clock: () => '2026-04-28T00:00:00.000Z',
    });
    const r = runCli(['verify', dir, '--strict-signatures']);
    expect(r.code).toBe(1);
    expect(r.stderr + r.stdout).toMatch(/REJECTED|unsigned/i);
  });
});
