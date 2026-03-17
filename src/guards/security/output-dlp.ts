/**
 * OutputDlpGuard — detects leaked secrets in agent output.
 *
 * Runs post-execution to catch AWS keys, API tokens, PEM keys, JWTs,
 * and other sensitive patterns before they reach the user or logs.
 */

import type { Guard, GuardResult, ProposedAction } from '../types.js';

const DLP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // AWS access keys
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key' },
  // AWS secret keys — require key-value context to avoid false positives on generic base64 strings
  {
    pattern: /(?:aws_secret_access_key|secret_?key|aws_secret)\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/i,
    label: 'AWS secret key',
  },
  // Anthropic API keys
  { pattern: /sk-ant-api\d{2}-[\w-]{20,}/, label: 'Anthropic API key' },
  // Generic long API keys (Bearer tokens, etc.)
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{32,}/, label: 'Bearer token' },
  // PEM private keys
  {
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
    label: 'PEM private key',
  },
  // JWTs (three base64url segments)
  {
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    label: 'JWT token',
  },
  // GitHub tokens
  { pattern: /\bghp_[A-Za-z0-9]{36}\b/, label: 'GitHub personal access token' },
  { pattern: /\bghs_[A-Za-z0-9]{36}\b/, label: 'GitHub server token' },
  // Slack tokens
  { pattern: /xox[bpras]-[\w-]{10,}/, label: 'Slack token' },
  // Generic secret patterns in key=value format
  {
    pattern: /(?:password|secret|token|api_key)\s*[:=]\s*["']?[^\s"']{8,}/i,
    label: 'credential in key-value',
  },
];

export class OutputDlpGuard implements Guard {
  readonly name = 'output-dlp';

  check(action: ProposedAction): GuardResult {
    if (!action.output) return { pass: true };

    for (const { pattern, label } of DLP_PATTERNS) {
      if (pattern.test(action.output)) {
        return {
          pass: false,
          reason: `Sensitive data detected in output: ${label}`,
        };
      }
    }

    return { pass: true };
  }
}
