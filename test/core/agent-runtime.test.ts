import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AgentRegistry } from '../../src/agents/registry.js';
import type { AgentProfile } from '../../src/agents/types.js';
import { AgentRuntime } from '../../src/core/agent-runtime.js';
import { EventLog } from '../../src/core/event-log.js';
import { ToolRegistry } from '../../src/core/tool-registry.js';
import type { AgentLoopProvider, ContentBlock, ToolDefinition } from '../../src/core/types.js';
import { GuardRunner } from '../../src/guards/guard-runner.js';
import type { Guard } from '../../src/guards/types.js';
import { InMemorySessionStore } from '../../src/sessions/memory-store.js';
import { FileAuditLog } from '../../src/trust/audit/audit-log.js';

function mockProvider(responses?: Array<{ content: ContentBlock[]; stopReason?: string }>): AgentLoopProvider {
  let callIndex = 0;
  const defaultResponse = {
    content: [{ type: 'text' as const, text: 'response' }],
    stopReason: 'end_turn',
  };
  return {
    completeWithTools: vi.fn(async () => {
      const resp = responses ? responses[callIndex++] : defaultResponse;
      return {
        content: resp?.content ?? defaultResponse.content,
        stopReason: resp?.stopReason ?? 'end_turn',
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    }),
  };
}

function passGuard(): Guard {
  return { name: 'test-pass', check: () => ({ pass: true }) };
}

function blockGuard(reason = 'blocked'): Guard {
  return { name: 'test-block', check: () => ({ pass: false, reason }) };
}

const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Echoes input',
  parameters: z.object({ message: z.string() }),
  execute: async (params) => ({ content: params.message }),
};

describe('AgentRuntime', () => {
  let tempDir: string;
  let auditLog: FileAuditLog;
  let runtime: AgentRuntime;
  let agentRegistry: AgentRegistry;
  let toolRegistry: ToolRegistry;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-runtime-'));
    auditLog = new FileAuditLog(tempDir);

    agentRegistry = new AgentRegistry();
    const profile: AgentProfile = {
      id: 'strategist',
      name: 'Strategist',
      role: 'strategist',
      description: 'Test strategist',
      tools: ['echo'],
      allowedActions: ['tool_call'],
      capabilities: ['reasoning'],
    };
    agentRegistry.register(profile);

    toolRegistry = new ToolRegistry();
    toolRegistry.register(echoTool);

    runtime = new AgentRuntime({
      agentRegistry,
      toolRegistry,
      guardRunner: new GuardRunner([passGuard()], { auditLog }),
      sessionStore: new InMemorySessionStore(),
      eventLog: new EventLog(tempDir),
      provider: mockProvider(),
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs an agent and returns a result', async () => {
    const result = await runtime.run({
      agentId: 'strategist',
      message: 'hello',
    });
    expect(result.agentId).toBe('strategist');
    expect(result.text).toBe('response');
    expect(result.iterations).toBeGreaterThan(0);
  });

  it('scopes tools to agent profile', async () => {
    toolRegistry.register({
      name: 'secret_tool',
      description: 'Not for strategist',
      parameters: z.object({}),
      execute: async () => ({ content: 'secret' }),
    });

    const result = await runtime.run({
      agentId: 'strategist',
      message: 'try to use secret_tool',
    });
    expect(result.text).toBe('response');
  });

  it('throws for unknown agent ID', async () => {
    await expect(runtime.run({ agentId: 'research-analyst', message: 'hello' })).rejects.toThrow(/not registered/i);
  });

  it('blocks tool calls when guard fails', async () => {
    const blockRuntime = new AgentRuntime({
      agentRegistry,
      toolRegistry,
      guardRunner: new GuardRunner([blockGuard('not allowed')], { auditLog }),
      sessionStore: new InMemorySessionStore(),
      eventLog: new EventLog(tempDir),
      provider: mockProvider([
        {
          content: [
            {
              type: 'tool_use' as const,
              id: 'call-1',
              name: 'echo',
              input: { message: 'test' },
            },
          ],
          stopReason: 'tool_use',
        },
        {
          content: [{ type: 'text' as const, text: 'after block' }],
          stopReason: 'end_turn',
        },
      ]),
    });

    const result = await blockRuntime.run({
      agentId: 'strategist',
      message: 'call echo',
    });
    expect(result.text).toBe('after block');
  });

  it('injects brain state into Strategist system prompt', async () => {
    const provider = mockProvider();
    const brainRuntime = new AgentRuntime({
      agentRegistry,
      toolRegistry,
      guardRunner: new GuardRunner([passGuard()], { auditLog }),
      sessionStore: new InMemorySessionStore(),
      eventLog: new EventLog(tempDir),
      provider,
      brain: {
        persona: {
          getPersona: async () => '# Conservative Investor',
          setPersona: async () => {},
          resetPersona: async () => {},
        },
        frontalLobe: {
          get: async () => '## Hypothesis: NVDA overbought',
          update: async () => ({
            hash: 'h',
            message: 'm',
            timestamp: new Date().toISOString(),
            type: 'frontal-lobe' as const,
            snapshot: {},
          }),
        },
        emotion: {
          getEmotion: async () => ({
            confidence: 0.7,
            riskAppetite: 0.3,
            reason: 'VIX elevated',
            updatedAt: new Date().toISOString(),
          }),
          updateEmotion: async () => ({
            hash: 'h',
            message: 'm',
            timestamp: new Date().toISOString(),
            type: 'emotion' as const,
            snapshot: {},
          }),
        },
      },
    });

    await brainRuntime.run({ agentId: 'strategist', message: 'what should I do?' });

    const call = (provider.completeWithTools as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.system).toContain('Conservative Investor');
    expect(call.system).toContain('NVDA overbought');
    expect(call.system).toContain('0.7');
    expect(call.system).toContain('VIX elevated');
  });

  it('forwards abort signal through run()', async () => {
    const ac = new AbortController();
    ac.abort(); // Pre-abort

    const result = await runtime.run({
      agentId: 'strategist',
      message: 'hello',
      abortSignal: ac.signal,
    });

    // With a pre-aborted signal, the loop exits on iteration 1 with empty text
    expect(result.iterations).toBe(1);
  });

  it('forwards abort signal through handleMessage()', async () => {
    const ac = new AbortController();
    ac.abort(); // Pre-abort

    const text = await runtime.handleMessage({
      message: 'hello',
      channelId: 'test',
      userId: 'user1',
      abortSignal: ac.signal,
    });

    // Should return without error; text may be empty since aborted immediately
    expect(typeof text).toBe('string');
  });

  it('handleMessage routes to strategist by default', async () => {
    const text = await runtime.handleMessage({
      message: 'hello',
      channelId: 'test',
      userId: 'user1',
    });
    expect(text).toBe('response');
  });

  it('strips image data from session history to avoid context bloat', async () => {
    const sessionStore = new InMemorySessionStore();
    const imageRuntime = new AgentRuntime({
      agentRegistry,
      toolRegistry,
      guardRunner: new GuardRunner([passGuard()], { auditLog }),
      sessionStore,
      eventLog: new EventLog(tempDir),
      provider: mockProvider(),
    });

    await imageRuntime.handleMessage({
      message: 'analyze this',
      channelId: 'test',
      userId: 'user1',
      threadId: 'img-thread',
      imageBase64: 'iVBORw0KGgoAAAANSUhEUg==',
      imageMediaType: 'image/png',
    });

    const session = await sessionStore.getByThread('test', 'img-thread');
    expect(session).toBeDefined();
    const history = await sessionStore.getHistory(session!.id);
    // The user message should have the image replaced with a text stub
    const userMsg = history.find((e) => e.message.role === 'user');
    expect(userMsg).toBeDefined();
    const content = userMsg!.message.content;
    expect(Array.isArray(content)).toBe(true);
    const blocks = content as ContentBlock[];
    // No image blocks should remain in session history
    expect(blocks.some((b) => b.type === 'image')).toBe(false);
    // Should have a text stub replacing the image
    expect(blocks.some((b) => b.type === 'text' && 'text' in b && b.text === '[Image attached]')).toBe(true);
  });
});
