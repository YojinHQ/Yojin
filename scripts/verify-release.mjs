#!/usr/bin/env node
/**
 * Pre-publish verifier.
 *
 * Walks every path the npm tarball promises to ship and asserts that the file
 * actually exists, is the right kind, and is non-empty where that matters. Run
 * automatically from `prepublishOnly`. Exits non-zero on the first failure so
 * a broken package never reaches the registry.
 */

import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const errors = [];

function fail(msg) {
  errors.push(msg);
}

function requireFile(relPath, { minSize = 0 } = {}) {
  const full = join(repoRoot, relPath);
  if (!existsSync(full)) {
    fail(`missing file: ${relPath}`);
    return;
  }
  const info = statSync(full);
  if (!info.isFile()) {
    fail(`not a file: ${relPath}`);
    return;
  }
  if (info.size < minSize) {
    fail(`file too small (${info.size} < ${minSize}): ${relPath}`);
  }
}

function requireDir(relPath, { minEntries = 1 } = {}) {
  const full = join(repoRoot, relPath);
  if (!existsSync(full) || !statSync(full).isDirectory()) {
    fail(`missing directory: ${relPath}`);
    return;
  }
  const entries = readdirSync(full);
  if (entries.length < minEntries) {
    fail(`directory nearly empty (${entries.length} < ${minEntries}): ${relPath}`);
  }
}

// Backend build output
requireFile('dist/src/entry.js', { minSize: 100 });
requireFile('dist/channels/web/src/channel.js', { minSize: 100 });

// Bundled React dashboard
requireFile('apps/web/dist/index.html', { minSize: 100 });
requireDir('apps/web/dist/assets', { minEntries: 2 });

// CLI bin
requireFile('yojin.mjs');

// Factory defaults
requireDir('data/default');
requireFile('data/default/persona.default.md');

// package.json sanity
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
if (!pkg.bin?.yojin) fail('package.json: missing bin.yojin');
if (!pkg.files?.includes('apps/web/dist/')) fail('package.json: files[] missing apps/web/dist/');
if (!pkg.files?.includes('dist/')) fail('package.json: files[] missing dist/');
if (pkg.version === '0.0.0') fail('package.json: version is 0.0.0');

if (errors.length > 0) {
  console.error('Release verification failed:');
  for (const err of errors) console.error('  -', err);
  process.exit(1);
}

console.log(`Release verified: yojin v${pkg.version} (bin, dist, web bundle, defaults all present)`);
