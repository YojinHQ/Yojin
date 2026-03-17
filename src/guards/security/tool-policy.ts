/**
 * ToolPolicyGuard — per-tool allow/deny with optional input validation.
 *
 * Enforces which tools can be called and optionally validates their inputs
 * against Zod schemas. Supports both allowlist and denylist modes.
 */

import { z } from 'zod';

import type { Guard, GuardResult, ProposedAction } from '../types.js';

export interface ToolPolicy {
  /** Tool name (exact match). */
  tool: string;
  /** Whether to allow or deny this tool. */
  action: 'allow' | 'deny';
  /** Optional Zod schema for input validation (only for 'allow' policies). */
  inputSchema?: z.ZodType;
  /** Reason shown when blocked. */
  reason?: string;
}

export interface ToolPolicyOptions {
  /** Default action when no policy matches a tool. */
  defaultAction?: 'allow' | 'deny';
  /** List of tool policies. */
  policies?: ToolPolicy[];
}

export class ToolPolicyGuard implements Guard {
  readonly name = 'tool-policy';
  private readonly defaultAction: 'allow' | 'deny';
  private readonly policies: ToolPolicy[];

  constructor(options?: ToolPolicyOptions) {
    this.defaultAction = options?.defaultAction ?? 'allow';
    this.policies = options?.policies ?? [];
  }

  check(action: ProposedAction): GuardResult {
    if (!action.toolName) return { pass: true };

    // Find matching policy
    const policy = this.policies.find((p) => p.tool === action.toolName);

    if (!policy) {
      // No specific policy — use default
      if (this.defaultAction === 'deny') {
        return {
          pass: false,
          reason: `Tool policy: ${action.toolName} not in allowlist`,
        };
      }
      return { pass: true };
    }

    if (policy.action === 'deny') {
      return {
        pass: false,
        reason: policy.reason ?? `Tool policy: ${action.toolName} is denied`,
      };
    }

    // Policy is 'allow' — optionally validate input schema
    if (policy.inputSchema && action.input !== undefined) {
      const result = policy.inputSchema.safeParse(action.input);
      if (!result.success) {
        return {
          pass: false,
          reason: `Tool policy: ${action.toolName} input validation failed: ${result.error.issues.map((i) => i.message).join(', ')}`,
        };
      }
    }

    return { pass: true };
  }

  /** Add a policy at runtime. */
  addPolicy(policy: ToolPolicy): void {
    this.policies.push(policy);
  }
}
