/**
 * Guard pipeline types.
 *
 * Guards are deterministic, pure-function checks that run before (or after)
 * every agent action. No LLM, no prompt, no interpretation — just rules.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Proposed action — the input to every guard
// ---------------------------------------------------------------------------

export const ProposedActionSchema = z.object({
  /** Action category: tool_call, file_access, network_request, trade, shell_command */
  type: z.string(),
  /** Tool being invoked (if applicable). */
  toolName: z.string().optional(),
  /** Raw tool input (if applicable). */
  input: z.unknown().optional(),
  /** File path being accessed (for fs-guard). */
  path: z.string().optional(),
  /** Shell command being executed (for command-guard). */
  command: z.string().optional(),
  /** Outbound URL (for egress-guard). */
  url: z.string().optional(),
  /** Agent output to check post-execution (for output-dlp). */
  output: z.string().optional(),
  /** Financial instrument symbol (for finance guards). */
  symbol: z.string().optional(),
  /** Agent performing the action. */
  agentId: z.string().optional(),
});
export type ProposedAction = z.infer<typeof ProposedActionSchema>;

// ---------------------------------------------------------------------------
// Guard result
// ---------------------------------------------------------------------------

export type GuardResult = { pass: true } | { pass: false; reason: string };

// ---------------------------------------------------------------------------
// Guard interface
// ---------------------------------------------------------------------------

export interface Guard {
  /** Unique guard name (e.g. 'fs-guard', 'rate-budget'). */
  name: string;
  /** Check a proposed action. Must be synchronous and side-effect free. */
  check(action: ProposedAction): GuardResult;
}

// ---------------------------------------------------------------------------
// Operational postures
// ---------------------------------------------------------------------------

export type PostureName = 'local' | 'standard' | 'unbounded';

export const PostureNameSchema = z.enum(['local', 'standard', 'unbounded']);

export interface PostureConfig {
  name: PostureName;
  /** Max tool calls per minute. */
  rateLimit: number;
  /** When true, all write/trade actions are blocked. */
  readOnly: boolean;
  /** Which guards are active ('*' = all). */
  guardsEnabled: string[];
  /** enforce = block on failure, observe = log but don't block. */
  mode: 'enforce' | 'observe';
}
