/**
 * GuardRunner — executes guards in sequence, blocks on first failure.
 *
 * Every decision (pass AND block) is logged to the security audit log.
 * In observe mode, blocks are logged but the action is allowed through.
 */

import { POSTURE_CONFIGS } from './posture.js';
import type { RateBudgetGuard } from './security/rate-budget.js';
import type { Guard, GuardResult, PostureName, ProposedAction } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { AuditLog } from '../trust/audit/types.js';

const logger = createSubsystemLogger('guard-runner');

export interface GuardRunnerOptions {
  auditLog: AuditLog;
  posture?: PostureName;
}

export class GuardRunner {
  private guards: Guard[];
  private readonly auditLog: AuditLog;
  private posture: PostureName;
  private frozen = false;

  constructor(guards: Guard[], options: GuardRunnerOptions) {
    this.guards = [...guards];
    this.auditLog = options.auditLog;
    this.posture = options.posture ?? 'local';
    logger.info('Guard runner initialized', {
      guardCount: guards.length,
      posture: this.posture,
      guards: guards.map((g) => g.name),
    });
  }

  /**
   * Freeze the pipeline — prevents addGuard, removeGuard, and setPosture.
   * Call after initialization to ensure the guard pipeline cannot be
   * modified at runtime (e.g., by a compromised agent).
   */
  freeze(): void {
    this.frozen = true;
    logger.info('Guard pipeline frozen');
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  /** Run all guards in sequence. Blocks on first failure. */
  check(action: ProposedAction): GuardResult {
    const config = POSTURE_CONFIGS[this.posture];
    const isObserve = config.mode === 'observe';
    const observedBlocks: string[] = [];

    for (const guard of this.guards) {
      // Skip disabled guards
      if (!this.isGuardEnabled(guard.name)) continue;

      const result = guard.check(action);

      if (!result.pass) {
        logger.warn('Guard blocked action', {
          guard: guard.name,
          tool: action.toolName,
          agentId: action.agentId,
          reason: result.reason,
          mode: config.mode,
        });
        this.auditLog.append({
          type: 'guard.block',
          agentId: action.agentId,
          details: {
            action: action.type,
            toolName: action.toolName,
            guardName: guard.name,
            reason: result.reason,
            mode: config.mode,
          },
        });

        if (isObserve) {
          // In observe mode, log the block but allow through
          observedBlocks.push(guard.name);
          continue;
        }

        return result;
      }
    }

    // All guards passed (or blocks were observed)
    this.auditLog.append({
      type: 'guard.pass',
      agentId: action.agentId,
      details: {
        action: action.type,
        toolName: action.toolName,
        guardsChecked: this.getActiveGuardCount(),
        posture: this.posture,
        mode: config.mode,
        ...(observedBlocks.length > 0 && { observedBlocks }),
      },
    });

    return { pass: true };
  }

  /** Switch operational posture. Throws if pipeline is frozen. */
  setPosture(posture: PostureName): void {
    if (this.frozen) {
      throw new Error('Cannot change posture: guard pipeline is frozen');
    }
    const from = this.posture;
    this.posture = posture;
    logger.info('Posture changed', { from, to: posture });

    // Propagate new rate limit to RateBudgetGuard
    const newConfig = POSTURE_CONFIGS[posture];
    const rateBudget = this.guards.find((g) => g.name === 'rate-budget') as RateBudgetGuard | undefined;
    rateBudget?.setMaxCalls(newConfig.rateLimit);

    this.auditLog.append({
      type: 'posture.change',
      details: { from, to: posture, changedBy: 'system' },
    });
  }

  getPosture(): PostureName {
    return this.posture;
  }

  /** Add a guard to the end of the pipeline. Throws if pipeline is frozen. */
  addGuard(guard: Guard): void {
    if (this.frozen) {
      throw new Error('Cannot add guard: guard pipeline is frozen');
    }
    this.guards.push(guard);
  }

  /** Remove a guard by name. Returns true if it existed. Throws if pipeline is frozen. */
  removeGuard(name: string): boolean {
    if (this.frozen) {
      throw new Error('Cannot remove guard: guard pipeline is frozen');
    }
    const before = this.guards.length;
    this.guards = this.guards.filter((g) => g.name !== name);
    return this.guards.length < before;
  }

  /** Get all registered guards. */
  getGuards(): Guard[] {
    return [...this.guards];
  }

  private isGuardEnabled(name: string): boolean {
    const config = POSTURE_CONFIGS[this.posture];
    return config.guardsEnabled.includes('*') || config.guardsEnabled.includes(name);
  }

  private getActiveGuardCount(): number {
    return this.guards.filter((g) => this.isGuardEnabled(g.name)).length;
  }
}
