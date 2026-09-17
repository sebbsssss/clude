#!/usr/bin/env node
/**
 * Swap in the npm-facing README while the tarball is built.
 *
 * The repo README serves the GitHub audience (project story, ecosystem);
 * README.npm.md is the SDK-consumer version that should appear on
 * npmjs.com. npm runs `prepack` before creating the tarball and `postpack`
 * right after, so the swap is invisible outside of packing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = path.join(root, 'README.md');
const npmReadme = path.join(root, 'README.npm.md');
const backup = path.join(root, '.README.repo.md');

const mode = process.argv[2];
if (mode === 'pack') {
  if (!fs.existsSync(npmReadme)) process.exit(0);
  fs.copyFileSync(readme, backup);
  fs.copyFileSync(npmReadme, readme);
} else if (mode === 'restore') {
  if (!fs.existsSync(backup)) process.exit(0);
  fs.copyFileSync(backup, readme);
  fs.rmSync(backup);
} else {
  console.error('usage: swap-readme.mjs pack|restore');
  process.exit(1);
}
