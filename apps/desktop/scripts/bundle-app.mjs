#!/usr/bin/env node
// Stage the self-contained Node backend + web bundle into the Tauri sidecar
// resource dir so end users get a working app out of the installer (no local
// Yojin checkout required).
//
// Output: apps/desktop/src-tauri/sidecar/app/ — contains dist/, apps/web/dist/,
// data/default/, package.json, yojin.mjs, node_modules/ (prod-only, hoisted).
//
// sidecar.rs resolves the entry script at resource_dir/sidecar/app/dist/src/entry.js.

import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STAGE_DIR = resolve(__dirname, '..', 'src-tauri', 'sidecar', 'app');
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with status ${result.status}`);
  }
}

if (existsSync(STAGE_DIR)) {
  console.log(`[bundle-app] clearing ${STAGE_DIR}`);
  rmSync(STAGE_DIR, { recursive: true, force: true });
}

// pnpm deploy copies the files listed in the root package.json `files` array
// (dist/, data/default/, apps/web/dist/, yojin.mjs, …) and installs prod deps.
// --legacy is required by pnpm v10 when the workspace isn't configured with
// inject-workspace-packages. --config.node-linker=hoisted writes a flat
// node_modules tree (no symlink farm via .pnpm) so the bundle is resilient to
// whatever Tauri / installer tooling does with symlinks during packaging.
console.log(`[bundle-app] pnpm deploy --prod → ${STAGE_DIR}`);
run('pnpm', ['--filter', '@yojinhq/yojin', '--config.node-linker=hoisted', 'deploy', '--prod', '--legacy', STAGE_DIR], {
  cwd: REPO_ROOT,
});

// Sanity check: the runtime-critical files must exist, otherwise sidecar.rs
// will fall through to its error path at launch.
const required = ['dist/src/entry.js', 'apps/web/dist/index.html', 'package.json', 'node_modules'];
for (const rel of required) {
  const p = resolve(STAGE_DIR, rel);
  if (!existsSync(p)) {
    throw new Error(`[bundle-app] missing required output: ${p}`);
  }
}

console.log(`[bundle-app] staged backend at ${STAGE_DIR}`);
