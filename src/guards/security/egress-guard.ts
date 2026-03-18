/**
 * EgressGuard — enforces network allowlist for outbound requests.
 *
 * Only approved domains/IPs are allowed. All other outbound requests
 * are blocked.
 */

import type { Guard, GuardResult, ProposedAction } from '../types.js';

const DEFAULT_ALLOWED_DOMAINS = ['api.anthropic.com', 'api.openai.com', 'localhost', '127.0.0.1'];

export interface EgressGuardOptions {
  allowedDomains?: string[];
  blockedPorts?: number[];
}

export class EgressGuard implements Guard {
  readonly name = 'egress-guard';
  private readonly allowedDomains: ReadonlySet<string>;
  private readonly blockedPorts: ReadonlySet<number>;

  constructor(options?: EgressGuardOptions) {
    this.allowedDomains = Object.freeze(new Set(options?.allowedDomains ?? DEFAULT_ALLOWED_DOMAINS));
    this.blockedPorts = Object.freeze(new Set(options?.blockedPorts ?? []));
  }

  check(action: ProposedAction): GuardResult {
    if (!action.url) return { pass: true };

    let parsed: URL;
    try {
      parsed = new URL(action.url);
    } catch {
      return { pass: false, reason: `Invalid URL: ${action.url}` };
    }

    const hostname = parsed.hostname;

    if (!this.allowedDomains.has(hostname)) {
      return {
        pass: false,
        reason: `Egress blocked: ${hostname} is not in the allowlist`,
      };
    }

    const port = parsed.port ? parseInt(parsed.port, 10) : undefined;
    if (port && this.blockedPorts.has(port)) {
      return {
        pass: false,
        reason: `Egress blocked: port ${port} is blocked`,
      };
    }

    return { pass: true };
  }
}
