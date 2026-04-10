#!/usr/bin/env node

/**
 * Downloads and installs the Yojin macOS menu bar app after `npm install -g`.
 * Best-effort — silently skips on non-macOS or if the download fails.
 */

import { execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:https';

if (platform() !== 'darwin') process.exit(0);

// Skip in development (running from the git repo via pnpm install)
const scriptDir = new URL('.', import.meta.url).pathname;
if (existsSync(join(scriptDir, '..', '.git'))) process.exit(0);

const INSTALL_DIR = join(homedir(), 'Applications');
const APP_NAME = 'Yojin.app';
const APP_PATH = join(INSTALL_DIR, APP_NAME);

// Read version from package.json
const pkgPath = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const repo = 'YojinHQ/Yojin';
const tag = `v${version}`;
const dmgUrl = `https://github.com/${repo}/releases/download/${tag}/Yojin.dmg`;

// Skip if already installed at this version
if (existsSync(APP_PATH)) {
  try {
    const plist = readFileSync(join(APP_PATH, 'Contents/Info.plist'), 'utf8');
    const match = plist.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/);
    if (match && match[1] === version) {
      console.log(`Yojin.app ${version} already installed.`);
      process.exit(0);
    }
  } catch {}
}

console.log(`Installing Yojin menu bar app ${tag}...`);

const tmpDir = join(homedir(), '.yojin', 'tmp');
const dmgPath = join(tmpDir, 'Yojin.dmg');

try {
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(INSTALL_DIR, { recursive: true });

  // Download DMG
  await download(dmgUrl, dmgPath);

  // Mount DMG
  const mountOutput = execFileSync('hdiutil', ['attach', dmgPath, '-nobrowse'], {
    encoding: 'utf8',
  });
  const mountPoint = mountOutput
    .split('\n')
    .map((l) => l.split('\t').pop()?.trim())
    .find((p) => p?.startsWith('/Volumes'));

  if (!mountPoint) throw new Error('Could not find mount point');

  const srcApp = join(mountPoint, APP_NAME);
  if (!existsSync(srcApp)) throw new Error(`${APP_NAME} not found in DMG`);

  // Remove old version if present
  if (existsSync(APP_PATH)) rmSync(APP_PATH, { recursive: true, force: true });

  // Copy new version
  execFileSync('cp', ['-R', srcApp, APP_PATH]);

  // Unmount
  try {
    execFileSync('hdiutil', ['detach', mountPoint, '-quiet']);
  } catch {}

  // Clean up
  rmSync(dmgPath, { force: true });

  // Launch the menu bar app
  try {
    execFileSync('open', [APP_PATH]);
  } catch {}

  console.log(`Yojin.app installed to ${INSTALL_DIR}`);
  console.log('Yojin menu bar app is running — look for the icon in your toolbar.');
} catch (err) {
  // Best-effort — don't fail the npm install
  console.log(`Note: Could not install Yojin menu bar app (${err.message})`);
  console.log(`You can download it manually from: https://github.com/${repo}/releases`);
  process.exit(0);
}

/** Follow redirects and download a file. */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const request = (u) => {
      get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          request(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', reject);
    };
    request(url);
  });
}
