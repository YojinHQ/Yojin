/**
 * Guard registry — factory that creates the default guard pipeline.
 *
 * Pipeline order matters:
 * 1. Kill switch (always first — emergency halt)
 * 2. Self-defense (protect config/audit files)
 * 3. Tool policy (per-tool allow/deny)
 * 4. Infrastructure guards (fs, command, egress, dlp, rate, repetition)
 * 5. Finance guards (read-only, cooldown, whitelist)
 */

import { CooldownGuard } from './finance/cooldown.js';
import { ReadOnlyGuard } from './finance/read-only.js';
import { SymbolWhitelistGuard } from './finance/symbol-whitelist.js';
import { CommandGuard } from './security/command-guard.js';
import { EgressGuard } from './security/egress-guard.js';
import { FsGuard } from './security/fs-guard.js';
import { KillSwitch } from './security/kill-switch.js';
import type { KillSwitchOptions } from './security/kill-switch.js';
import { OutputDlpGuard } from './security/output-dlp.js';
import { RateBudgetGuard } from './security/rate-budget.js';
import { RepetitionGuard } from './security/repetition-guard.js';
import { SelfDefenseGuard } from './security/self-defense.js';
import { ToolPolicyGuard } from './security/tool-policy.js';
import type { ToolPolicy } from './security/tool-policy.js';
import type { Guard, PostureConfig } from './types.js';

export interface GuardRegistryOptions {
  egressAllowedDomains?: string[];
  symbolWhitelist?: string[];
  /** Paths to protect from modification (self-defense guard). */
  protectedPaths?: string[];
  /** Tool-level policies. */
  toolPolicies?: ToolPolicy[];
  /** Default action for tools not in the policy list. */
  toolPolicyDefault?: 'allow' | 'deny';
  /** Kill switch options. */
  killSwitch?: KillSwitchOptions;
}

export interface GuardRegistryResult {
  guards: Guard[];
  /** Reference to the kill switch for programmatic trip/reset. */
  killSwitch: KillSwitch;
}

/**
 * Create the default guard pipeline for a given posture.
 * Returns guards in execution order plus a reference to the kill switch.
 */
export function createDefaultGuards(posture: PostureConfig, options?: GuardRegistryOptions): GuardRegistryResult {
  const killSwitch = new KillSwitch(options?.killSwitch);

  const guards: Guard[] = [
    // 1. Emergency halt — always first
    killSwitch,
    // 2. Config/audit file protection
    ...(options?.protectedPaths?.length
      ? [new SelfDefenseGuard({ protectedPaths: options.protectedPaths, killSwitch })]
      : []),
    // 3. Per-tool allow/deny
    ...(options?.toolPolicies?.length
      ? [
          new ToolPolicyGuard({
            defaultAction: options.toolPolicyDefault,
            policies: options.toolPolicies,
          }),
        ]
      : []),
    // 4. Infrastructure guards
    new FsGuard(),
    new CommandGuard(),
    new EgressGuard({ allowedDomains: options?.egressAllowedDomains }),
    new OutputDlpGuard(),
    new RateBudgetGuard({ maxCallsPerMinute: posture.rateLimit }),
    new RepetitionGuard(),
    // 5. Finance guards
    new ReadOnlyGuard({ enabled: posture.readOnly }),
    new CooldownGuard(),
    new SymbolWhitelistGuard({ symbols: options?.symbolWhitelist }),
  ];

  return { guards, killSwitch };
}
