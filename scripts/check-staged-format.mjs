#!/usr/bin/env node
// Safety net: verify staged files are formatted after lint-staged has run.
// Cross-platform alternative to `git diff ... | grep ... | xargs prettier --check`.

import { execFileSync, spawnSync } from 'node:child_process';

const FORMATTABLE = /\.(?:ts|tsx|js|jsx|mjs|json|yml|yaml|css|html|graphql)$/i;

function getStagedFiles() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && FORMATTABLE.test(line));
}

const files = getStagedFiles();
if (files.length === 0) {
  process.exit(0);
}

const result = spawnSync('pnpm', ['exec', 'prettier', '--check', ...files], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  console.error('');
  console.error('ERROR: Staged files have formatting issues that lint-staged did not fix.');
  console.error('Run: pnpm exec prettier --write <file> && git add <file>');
  process.exit(1);
}
