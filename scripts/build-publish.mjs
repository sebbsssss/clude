#!/usr/bin/env node
/**
 * build-publish.mjs — Produce the root-level `dist/` used for `npm publish`.
 *
 * After the monorepo refactor, the brain's compiled output lives at
 * packages/brain/dist/ and imports `@clude/shared` via workspace. That can't
 * be published directly because `@clude/shared` isn't on npm.
 *
 * This script uses esbuild to produce a self-contained bundle at repo root:
 *   dist/cli/index.js       — the `clude` CLI binary
 *   dist/sdk/index.js       — the `Cortex` SDK exported as the package main
 *   dist/mcp/server.js      — the MCP server (exports["./mcp"])
 *   dist/mcp/local-store.js — the local MCP store (exports["./local"])
 *
 * Workspace packages (`@clude/*`) are inlined. All declared npm deps in
 * packages/brain and packages/shared are kept external so users' package
 * managers resolve them.
 */

import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function readDeps(pkgRelPath) {
  const p = path.join(repoRoot, pkgRelPath);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return {
    ...(j.dependencies ?? {}),
    ...(j.peerDependencies ?? {}),
    ...(j.optionalDependencies ?? {}),
  };
}

// The CLI and MCP server report the version from packages/brain/package.json
// (inlined at bundle time). If it drifts from the published version, users see
// conflicting numbers — fail the build instead.
const rootVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const brainVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/brain/package.json'), 'utf8')).version;
if (rootVersion !== brainVersion) {
  throw new Error(`version mismatch: root package.json is ${rootVersion} but packages/brain is ${brainVersion} — align them before publishing`);
}

// Everything the bundled code might require at runtime. Treat any @clude/*
// as internal (will be inlined); everything else external so users resolve it.
const allDeps = {
  ...readDeps('package.json'),
  ...readDeps('packages/brain/package.json'),
  ...readDeps('packages/shared/package.json'),
};
const externals = Object.keys(allDeps).filter((name) => !name.startsWith('@clude/'));

// Each CLI entry's shebang in the source is preserved automatically by esbuild —
// no banner needed (adding one duplicates the shebang and crashes the binary).
const entries = [
  { in: 'packages/brain/src/cli/index.ts',      out: 'dist/cli/index.js'      },
  { in: 'packages/brain/src/sdk/index.ts',      out: 'dist/sdk/index.js'      },
  { in: 'packages/brain/src/mcp/server.ts',     out: 'dist/mcp/server.js'     },
  { in: 'packages/brain/src/mcp/local-store.ts',out: 'dist/mcp/local-store.js'},
];

// Clean previous output
const distDir = path.join(repoRoot, 'dist');
fs.rmSync(distDir, { recursive: true, force: true });

for (const { in: entryPoint, out } of entries) {
  const entryAbs = path.join(repoRoot, entryPoint);
  if (!fs.existsSync(entryAbs)) {
    throw new Error(`entry missing: ${entryPoint}`);
  }
  await esbuild.build({
    entryPoints: [entryAbs],
    outfile: path.join(repoRoot, out),
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: externals,
    sourcemap: false,
    logLevel: 'info',
    loader: { '.node': 'file' },
  });
  console.log(`✓ built ${out}`);
}

// Make CLI executable
fs.chmodSync(path.join(repoRoot, 'dist/cli/index.js'), 0o755);

// Copy supabase schema to root so exports["./schema"] resolves
const schemaSrc = path.join(repoRoot, 'packages/database/supabase-schema.sql');
const schemaDst = path.join(repoRoot, 'supabase-schema.sql');
if (fs.existsSync(schemaSrc)) {
  fs.copyFileSync(schemaSrc, schemaDst);
  console.log('✓ copied supabase-schema.sql to root');
}

// ── Type declarations ────────────────────────────────────────────────
// tsc already emits .d.ts under packages/brain/dist; ship the SDK and MCP
// surfaces so TypeScript consumers get types instead of TS7016. The only
// cross-package type import is @clude/shared/utils/constants, which isn't
// published — vendor it next to the SDK types and rewrite the import.
const brainDist = path.join(repoRoot, 'packages/brain/dist');
const sharedConstants = path.join(repoRoot, 'packages/shared/dist/utils/constants.d.ts');

function copyDts(srcRel, dstRel) {
  const src = path.join(brainDist, srcRel);
  if (!fs.existsSync(src)) throw new Error(`missing declaration file: ${src} — run the brain build first`);
  let text = fs.readFileSync(src, 'utf8');
  text = text
    .replace(/from '@clude\/shared\/utils\/constants'/g, "from './shared-constants'")
    .replace(/from '\.\.\/memory'/g, "from './memory-types'")
    .replace(/\/\/# sourceMappingURL=.*\n?/g, '');
  fs.writeFileSync(path.join(repoRoot, dstRel), text);
}

for (const f of ['index', 'cortex', 'cortex-v2', 'types', 'http-transport', 'sdk-mode']) {
  copyDts(`sdk/${f}.d.ts`, `dist/sdk/${f}.d.ts`);
}
// sdk/types.d.ts imports its memory types from ../memory — vendor that module
copyDts('memory/memory.d.ts', 'dist/sdk/memory-types.d.ts');
copyDts('mcp/server.d.ts', 'dist/mcp/server.d.ts');
copyDts('mcp/local-store.d.ts', 'dist/mcp/local-store.d.ts');
fs.writeFileSync(
  path.join(repoRoot, 'dist/sdk/shared-constants.d.ts'),
  fs.readFileSync(sharedConstants, 'utf8').replace(/\/\/# sourceMappingURL=.*\n?/g, ''),
);
console.log('✓ copied type declarations (sdk + mcp)');

console.log('\nbuild-publish complete.');
