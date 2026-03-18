import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Orchestrator } from '../../src/agents/orchestrator.js';
import { AgentRegistry } from '../../src/agents/registry.js';
import type { AgentProfile, AgentStepResult, Workflow } from '../../src/agents/types.js';
import { AgentRuntime } from '../../src/core/agent-runtime.js';
import { EventLog } from '../../src/core/event-log.js';
import { ToolRegistry } from '../../src/core/tool-registry.js';
import type { AgentLoopProvider } from '../../src/core/types.js';
import { GuardRunner } from '../../src/guards/guard-runner.js';
import { InMemorySessionStore } from '../../src/sessions/memory-store.js';
import { FileAuditLog } from '../../src/trust/audit/audit-log.js';

type StubRole = 'analyst' | 'strategist' | 'risk-manager' | 'trader';
const ROLE_MAP: Record<string, StubRole> = {
  'research-analyst': 'analyst',
  strategist: 'strategist',
  'risk-manager': 'risk-manager',
  trader: 'trader',
};

function stubProfile(id: string): AgentProfile {
  return {
    id,
    name: id,
    role: ROLE_MAP[id] ?? 'analyst',
    description: `${id} agent`,
    tools: [],
    allowedActions: ['tool_call'],
    capabilities: ['testing'],
  };
}

function mockProvider(): AgentLoopProvider {
  let callCount = 0;
  return {
    completeWithTools: vi.fn(async (params) => {
      callCount++;
      const system = params.system ?? '';
      const agentHint = system.split('\n')[0]?.replace('# ', '') ?? `call-${callCount}`;
      return {
        content: [{ type: 'text' as const, text: `Response from ${agentHint}` }],
        stopReason: 'end_turn',
        usage: { inputTokens: 50, outputTokens: 25 },
      };
    }),
  };
}

describe('Orchestrator', () => {
  let tempDir: string;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-orch-'));
    const auditLog = new FileAuditLog(tempDir);

    const agentRegistry = new AgentRegistry();
    agentRegistry.register(stubProfile('research-analyst'));
    agentRegistry.register(stubProfile('strategist'));
    agentRegistry.register(stubProfile('risk-manager'));
    agentRegistry.register(stubProfile('trader'));

    const runtime = new AgentRuntime({
      agentRegistry,
      toolRegistry: new ToolRegistry(),
      guardRunner: new GuardRunner([{ name: 'pass', check: () => ({ pass: true }) }], { auditLog }),
      sessionStore: new InMemorySessionStore(),
      eventLog: new EventLog(tempDir),
      provider: mockProvider(),
    });

    orchestrator = new Orchestrator(runtime);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('executes a sequential workflow', async () => {
    const workflow: Workflow = {
      id: 'test-sequential',
      name: 'Test Sequential',
      stages: [
        { agentId: 'research-analyst', buildMessage: () => 'analyze data' },
        {
          agentId: 'strategist',
          buildMessage: (prev) => `decide based on: ${prev.get('research-analyst')?.text}`,
        },
      ],
    };
    orchestrator.register(workflow);

    const results = await orchestrator.execute('test-sequential', { message: 'go' });
    expect(results.size).toBe(2);
    expect(results.has('research-analyst')).toBe(true);
    expect(results.has('strategist')).toBe(true);
  });

  it('executes parallel stages', async () => {
    const workflow: Workflow = {
      id: 'test-parallel',
      name: 'Test Parallel',
      stages: [
        [
          { agentId: 'research-analyst', buildMessage: () => 'research' },
          { agentId: 'risk-manager', buildMessage: () => 'analyze risk' },
        ],
        {
          agentId: 'strategist',
          buildMessage: (prev) => `both done: ${prev.size} results`,
        },
      ],
    };
    orchestrator.register(workflow);

    const results = await orchestrator.execute('test-parallel', { message: 'go' });
    expect(results.size).toBe(3);
  });

  it('throws for unknown workflow ID', async () => {
    await expect(orchestrator.execute('nonexistent', {})).rejects.toThrow(/not found/i);
  });

  it('passes previous outputs and trigger message to buildMessage', async () => {
    const buildMessage = vi.fn((_prev: Map<string, AgentStepResult>, trigger?: string) => {
      return `trigger: ${trigger ?? 'none'}`;
    });

    const workflow: Workflow = {
      id: 'test-trigger',
      name: 'Test Trigger',
      stages: [
        { agentId: 'research-analyst', buildMessage: () => 'first step' },
        { agentId: 'strategist', buildMessage },
      ],
    };
    orchestrator.register(workflow);

    await orchestrator.execute('test-trigger', { message: 'Analyze NVDA' });
    expect(buildMessage).toHaveBeenCalledWith(expect.any(Map), 'Analyze NVDA');
  });

  it('completes workflow when agents have no registered tools', async () => {
    const workflow: Workflow = {
      id: 'test-no-tools',
      name: 'Test No Tools',
      stages: [{ agentId: 'strategist', buildMessage: () => 'reason without tools' }],
    };
    orchestrator.register(workflow);

    const results = await orchestrator.execute('test-no-tools', {});
    expect(results.size).toBe(1);
    expect(results.get('strategist')?.text).toBeTruthy();
  });
});
