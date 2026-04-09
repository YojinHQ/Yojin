/**
 * Package metadata loader.
 *
 * Reads the package's own `package.json` by walking up from this module's
 * directory until one is found. Works identically in tsx dev (`src/...`) and
 * from the compiled tarball (`dist/src/...`) without hardcoding a relative
 * depth that breaks when the layout changes.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function readOwnPackageJson(): { version: string } {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = resolve(dir, 'package.json');
    if (existsSync(candidate)) {
      return JSON.parse(readFileSync(candidate, 'utf-8')) as { version: string };
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('package.json not found walking up from package-meta');
    }
    dir = parent;
  }
}

export const PKG_VERSION: string = readOwnPackageJson().version;
