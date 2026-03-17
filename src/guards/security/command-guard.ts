/**
 * CommandGuard — blocks dangerous shell commands via regex matching.
 */

import type { Guard, GuardResult, ProposedAction } from '../types.js';

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bsudo\b/, label: 'sudo' },
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|--recursive\s+)\//, label: 'rm -r /' },
  { pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*r/, label: 'rm -rf' },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+-[a-zA-Z]*f/, label: 'rm -rf' },
  { pattern: /\brm\s+-[a-zA-Z]*rf/, label: 'rm -rf' },
  { pattern: /\bchmod\s+777\b/, label: 'chmod 777' },
  { pattern: /\bmkfs\b/, label: 'mkfs' },
  { pattern: /\bdd\s+if=/, label: 'dd' },
  { pattern: /\|\s*(ba)?sh\b/, label: 'pipe to shell' },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh/, label: 'curl piped to shell' },
  { pattern: /\bwget\b.*\|\s*(ba)?sh/, label: 'wget piped to shell' },
  { pattern: />\s*\/dev\/[a-z]/, label: 'write to device' },
  { pattern: /\b:()\s*\{\s*:\|\s*:&\s*\};\s*:/, label: 'fork bomb' },
];

export class CommandGuard implements Guard {
  readonly name = 'command-guard';

  check(action: ProposedAction): GuardResult {
    if (!action.command) return { pass: true };

    for (const { pattern, label } of DANGEROUS_PATTERNS) {
      if (pattern.test(action.command)) {
        return {
          pass: false,
          reason: `Dangerous command blocked: ${label}`,
        };
      }
    }

    return { pass: true };
  }
}
