import { describe, expect, it } from 'vitest';

import type { ToolDefinition } from '../../src/core/types.js';
import type { GuardRunner } from '../../src/guards/guard-runner.js';
import type { GuardResult, PostureName } from '../../src/guards/types.js';
import { createSecurityAuditTools } from '../../src/tools/security-audit.js';

function makeGuardRunner(
  options: {
    result?: GuardResult;
    posture?: PostureName;
  } = {},
): GuardRunner {
  const { result = { pass: true }, posture = 'local' } = options;
  return {
    check: () => result,
    getPosture: () => posture,
  } as unknown as GuardRunner;
}

describe('createSecurityAuditTools', () => {
  it('creates 1 tool', () => {
    const tools = createSecurityAuditTools({ guardRunner: makeGuardRunner() });
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('security_audit_check');
  });
});

describe('security_audit_check', () => {
  function getAuditTool(options: Parameters<typeof makeGuardRunner>[0] = {}): ToolDefinition {
    return createSecurityAuditTools({ guardRunner: makeGuardRunner(options) })[0];
  }

  it('reports ALLOWED when guard passes', async () => {
    const tool = getAuditTool({ result: { pass: true }, posture: 'standard' });
    const result = await tool.execute({
      actionType: 'tool_call',
      toolName: 'openbb_equity_quote',
    });

    expect(result.content).toContain('ALLOWED');
    expect(result.content).toContain('tool_call');
    expect(result.content).toContain('standard');
    expect(result.content).toContain('openbb_equity_quote');
  });

  it('reports BLOCKED with reason when guard fails', async () => {
    const tool = getAuditTool({
      result: { pass: false, reason: 'Read-only mode: trades not allowed' },
      posture: 'local',
    });
    const result = await tool.execute({
      actionType: 'trade',
      symbol: 'AAPL',
    });

    expect(result.content).toContain('BLOCKED');
    expect(result.content).toContain('Read-only mode');
    expect(result.content).toContain('local');
    expect(result.content).toContain('AAPL');
  });

  it('works with minimal parameters', async () => {
    const tool = getAuditTool();
    const result = await tool.execute({ actionType: 'network_request' });

    expect(result.content).toContain('ALLOWED');
    expect(result.content).toContain('network_request');
  });

  it('includes agentId context when provided', async () => {
    const tool = getAuditTool({
      result: { pass: false, reason: 'Rate limit exceeded' },
    });
    const result = await tool.execute({
      actionType: 'tool_call',
      toolName: 'enrich_position',
      agentId: 'research-analyst',
    });

    expect(result.content).toContain('BLOCKED');
    expect(result.content).toContain('Rate limit exceeded');
  });
});
