/**
 * GuardedToolRegistry — wraps ToolRegistry with guard pipeline + approval gate.
 *
 * Flow:
 * 1. Build ProposedAction from tool call
 * 2. Run pre-execution guards
 * 3. If blocked → return error result
 * 4. If needs approval → wait for approve/deny
 * 5. Execute tool
 * 6. Run post-execution guard (output-dlp) on result
 * 7. Return result
 */

import type { ToolRegistry } from '../core/tool-registry.js';
import type { ToolCallContext, ToolExecutor, ToolResult } from '../core/types.js';
import type { GuardRunner } from '../guards/guard-runner.js';
import type { ProposedAction } from '../guards/types.js';
import type { ApprovalGate } from './approval/approval-gate.js';
import type { OutputDlpGuard } from '../guards/security/output-dlp.js';

export interface GuardedToolRegistryOptions {
  registry: ToolRegistry;
  guardRunner: GuardRunner;
  approvalGate?: ApprovalGate;
  outputDlp?: OutputDlpGuard;
}

export class GuardedToolRegistry implements ToolExecutor {
  private readonly registry: ToolRegistry;
  private readonly guardRunner: GuardRunner;
  private readonly approvalGate?: ApprovalGate;
  private readonly outputDlp?: OutputDlpGuard;

  constructor(options: GuardedToolRegistryOptions) {
    this.registry = options.registry;
    this.guardRunner = options.guardRunner;
    this.approvalGate = options.approvalGate;
    this.outputDlp = options.outputDlp;
  }

  async execute(name: string, input: unknown, context?: ToolCallContext): Promise<ToolResult> {
    // 1. Build proposed action
    const action: ProposedAction = {
      type: 'tool_call',
      toolName: name,
      input,
      agentId: context?.agentId,
    };

    // 2. Run pre-execution guards
    const guardResult = this.guardRunner.check(action);
    if (!guardResult.pass) {
      return {
        content: `Blocked by guard: ${guardResult.reason}`,
        isError: true,
      };
    }

    // 3. Check if approval is needed
    if (this.approvalGate?.needsApproval(name)) {
      const approval = await this.approvalGate.requestApproval(
        name,
        `Tool call: ${name} with input: ${JSON.stringify(input)}`,
        context?.agentId,
      );
      if (!approval.approved) {
        return {
          content: `Action denied: ${approval.reason}`,
          isError: true,
        };
      }
    }

    // 4. Execute tool
    const result = await this.registry.execute(name, input);

    // 5. Post-execution DLP check on output
    if (this.outputDlp && result.content) {
      const dlpAction: ProposedAction = {
        type: 'tool_call',
        toolName: name,
        output: result.content,
        agentId: context?.agentId,
      };

      const dlpResult = this.outputDlp.check(dlpAction);
      if (!dlpResult.pass) {
        return {
          content: `Output blocked by DLP: ${dlpResult.reason}. The tool executed but its output was suppressed.`,
          isError: true,
        };
      }
    }

    return result;
  }

  /** Delegate to inner registry for schema generation. */
  get inner(): ToolRegistry {
    return this.registry;
  }
}
