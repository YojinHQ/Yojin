/**
 * Security audit tool — dry-run actions through the guard pipeline.
 *
 * Lets agents ask "would this action be allowed?" before attempting it.
 * The guard pipeline is deterministic (pure functions), so this is a safe
 * read-only check that doesn't execute anything.
 */

import { z } from 'zod';

import type { ToolDefinition, ToolResult } from '../core/types.js';
import type { GuardRunner } from '../guards/guard-runner.js';
import type { ProposedAction } from '../guards/types.js';

export interface SecurityAuditOptions {
  guardRunner: GuardRunner;
}

export function createSecurityAuditTools(options: SecurityAuditOptions): ToolDefinition[] {
  const { guardRunner } = options;

  const auditCheck: ToolDefinition = {
    name: 'security_audit_check',
    description:
      'Dry-run an action through the guard pipeline to check if it would be ' +
      'allowed or blocked. Does NOT execute the action — only checks guards. ' +
      'Use this before recommending actions that might violate constraints.',
    parameters: z.object({
      actionType: z.string().describe('Action type: tool_call, file_access, network_request, trade, shell_command'),
      toolName: z.string().optional().describe('Tool name (if action is a tool_call)'),
      symbol: z.string().optional().describe('Financial symbol (if relevant)'),
      agentId: z.string().optional().describe('Agent performing the action'),
    }),
    async execute(params: {
      actionType: string;
      toolName?: string;
      symbol?: string;
      agentId?: string;
    }): Promise<ToolResult> {
      const action: ProposedAction = {
        type: params.actionType,
        toolName: params.toolName,
        symbol: params.symbol,
        agentId: params.agentId,
      };

      const result = guardRunner.check(action);

      if (result.pass) {
        return {
          content: [
            `ALLOWED — action "${params.actionType}" would pass the guard pipeline.`,
            `Posture: ${guardRunner.getPosture()}`,
            params.toolName ? `Tool: ${params.toolName}` : null,
            params.symbol ? `Symbol: ${params.symbol}` : null,
          ]
            .filter(Boolean)
            .join('\n'),
        };
      }

      return {
        content: [
          `BLOCKED — action "${params.actionType}" would be rejected.`,
          `Reason: ${result.reason}`,
          `Posture: ${guardRunner.getPosture()}`,
          params.toolName ? `Tool: ${params.toolName}` : null,
          params.symbol ? `Symbol: ${params.symbol}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    },
  };

  return [auditCheck];
}
