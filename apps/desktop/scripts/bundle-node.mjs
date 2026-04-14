#!/usr/bin/env node
// Download a standalone Node runtime and place its `node` binary inside the
// Tauri sidecar resource dir so end users don't need Node on PATH.
//
// Usage:
//   node scripts/bundle-node.mjs            # host platform only (dev/local build)
//   node scripts/bundle-node.mjs --all      # every supported target (CI/release)
//   node scripts/bundle-node.mjs --target=darwin-arm64
//
// Output: apps/desktop/src-tauri/sidecar/node[.exe] for the host build, and
// platform-suffixed copies (node-darwin-arm64, node-win-x64.exe, ...) when
// --all is used so a CI matrix can pick the right one per Tauri target.

import { createWriteStream, existsSync, mkdirSync, chmodSync, copyFileSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

const NODE_VERSION = '22.12.0';

const TARGETS = {
  'darwin-x64': { archive: `node-v${NODE_VERSION}-darwin-x64.tar.xz`, binary: 'bin/node', ext: '' },
  'darwin-arm64': { archive: `node-v${NODE_VERSION}-darwin-arm64.tar.xz`, binary: 'bin/node', ext: '' },
  'linux-x64': { archive: `node-v${NODE_VERSION}-linux-x64.tar.xz`, binary: 'bin/node', ext: '' },
  'linux-arm64': { archive: `node-v${NODE_VERSION}-linux-arm64.tar.xz`, binary: 'bin/node', ext: '' },
  'win-x64': { archive: `node-v${NODE_VERSION}-win-x64.zip`, binary: 'node.exe', ext: '.exe' },
  'win-arm64': { archive: `node-v${NODE_VERSION}-win-arm64.zip`, binary: 'node.exe', ext: '.exe' },
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIDECAR_DIR = resolve(__dirname, '..', 'src-tauri', 'sidecar');

function detectHostTarget() {
  const platform = process.platform;
  const arch = process.arch;
  const map = {
    'darwin-x64': 'darwin-x64',
    'darwin-arm64': 'darwin-arm64',
    'linux-x64': 'linux-x64',
    'linux-arm64': 'linux-arm64',
    'win32-x64': 'win-x64',
    'win32-arm64': 'win-arm64',
  };
  const key = `${platform}-${arch}`;
  const target = map[key];
  if (!target) {
    throw new Error(`Unsupported host platform: ${key}`);
  }
  return target;
}

async function downloadFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  if (!res.body) {
    throw new Error(`Empty response body from ${url}`);
  }
  await pipeline(res.body, createWriteStream(dest));
}

function extract(archivePath, destDir, isZip) {
  if (!isZip) {
    const result = spawnSync('tar', ['-xJf', archivePath, '-C', destDir], { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`tar extraction failed for ${archivePath}`);
    }
    return;
  }

  // Windows stock shells don't have `unzip`, but every Windows 10+ install has
  // PowerShell with `Expand-Archive` built in. Prefer it on win32 hosts and
  // fall back to `unzip` elsewhere (Linux/macOS CI boxes cross-bundling the
  // Windows archive).
  if (process.platform === 'win32') {
    const script = `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(destDir)} -Force`;
    const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`PowerShell Expand-Archive failed for ${archivePath}`);
    }
    return;
  }

  const result = spawnSync('unzip', ['-q', archivePath, '-d', destDir], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`unzip extraction failed for ${archivePath}`);
  }
}

async function bundleTarget(target, { suffixed }) {
  const spec = TARGETS[target];
  if (!spec) {
    throw new Error(`Unknown target: ${target}`);
  }

  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${spec.archive}`;
  const isZip = spec.archive.endsWith('.zip');
  const tmp = await mkdtemp(join(tmpdir(), 'yojin-node-'));
  const archivePath = join(tmp, spec.archive);

  console.log(`[bundle-node] ${target}: downloading ${url}`);
  try {
    await downloadFile(url, archivePath);
    console.log(`[bundle-node] ${target}: extracting`);
    extract(archivePath, tmp, isZip);

    // Inside the archive each distribution unpacks to a single top-level
    // directory matching the archive stem (e.g. `node-v22.12.0-darwin-arm64/`).
    const stem = spec.archive.replace(/\.(tar\.xz|zip)$/, '');
    const binarySrc = join(tmp, stem, spec.binary);
    if (!existsSync(binarySrc)) {
      throw new Error(`Expected binary at ${binarySrc} after extraction`);
    }

    mkdirSync(SIDECAR_DIR, { recursive: true });
    const outName = suffixed ? `node-${target}${spec.ext}` : `node${spec.ext}`;
    const outPath = join(SIDECAR_DIR, outName);
    copyFileSync(binarySrc, outPath);
    if (spec.ext === '') {
      chmodSync(outPath, 0o755);
    }
    console.log(`[bundle-node] ${target}: wrote ${outPath}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const wantsAll = args.includes('--all');
  const explicit = args.find((a) => a.startsWith('--target='))?.split('=')[1];

  let targets;
  if (wantsAll) {
    targets = Object.keys(TARGETS);
  } else if (explicit) {
    targets = [explicit];
  } else {
    targets = [detectHostTarget()];
  }

  // Refresh sidecar dir for the host build so a stale node from a prior arch
  // can't accidentally end up in the bundle.
  if (!wantsAll && !explicit && existsSync(SIDECAR_DIR)) {
    for (const name of ['node', 'node.exe']) {
      const p = join(SIDECAR_DIR, name);
      if (existsSync(p)) rmSync(p);
    }
  }

  for (const target of targets) {
    await bundleTarget(target, { suffixed: wantsAll || Boolean(explicit) });
  }
}

main().catch((err) => {
  console.error(`[bundle-node] FAILED: ${err.message}`);
  process.exit(1);
});
