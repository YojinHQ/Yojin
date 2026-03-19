import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { runAgentLoop } from '../../src/core/agent-loop.js';
import type {
  AgentLoopEvent,
  AgentLoopProvider,
  AgentMessage,
  ContentBlock,
  ToolDefinition,
} from '../../src/core/types.js';
import { GuardRunner } from '../../src/guards/guard-runner.js';
import { OutputDlpGuard } from '../../src/guards/security/output-dlp.js';
import type { Guard, GuardResult, ProposedAction } from '../../src/guards/types.js';
import type { AuditEvent, AuditEventInput, AuditLog } from '../../src/trust/audit/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock provider that returns canned responses in sequence. */
function mockProvider(
  responses: Array<{
    content: ContentBlock[];
    stopReason?: string;
  }>,
): AgentLoopProvider {
  let callIndex = 0;
  return {
    completeWithTools: vi.fn(async () => {
      const resp = responses[callIndex++];
      if (!resp) throw new Error('Mock provider exhausted — no more responses');
      return {
        content: resp.content,
        stopReason: resp.stopReason ?? 'end_turn',
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    }),
  };
}

function textResponse(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    stopReason: 'end_turn',
  };
}

function toolCallResponse(calls: Array<{ id: string; name: string; input: unknown }>) {
  return {
    content: calls.map((c) => ({
      type: 'tool_use' as const,
      id: c.id,
      name: c.name,
      input: c.input,
    })),
    stopReason: 'tool_use',
  };
}

const echoTool: ToolDefinition = {
  name: 'echo',
  description: 'Echoes back the input',
  parameters: z.object({ message: z.string() }),
  execute: async ({ message }) => ({ content: `Echo: ${message}` }),
};

const failTool: ToolDefinition = {
  name: 'always_fail',
  description: 'Always throws',
  parameters: z.object({}),
  execute: async () => {
    throw new Error('intentional failure');
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAgentLoop', () => {
  it('returns text response when LLM does not call tools', async () => {
    const provider = mockProvider([textResponse('Hello!')]);

    const result = await runAgentLoop('Hi', [], {
      provider,
      model: 'test-model',
    });

    expect(result.text).toBe('Hello!');
    expect(result.iterations).toBe(1);
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(50);
  });

  it('executes a single tool call and returns final answer', async () => {
    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'echo', input: { message: 'ping' } }]),
      textResponse('The echo said: Echo: ping'),
    ]);

    const result = await runAgentLoop('Echo ping please', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
    });

    expect(result.text).toBe('The echo said: Echo: ping');
    expect(result.iterations).toBe(2);
    // Should have called provider twice
    expect(provider.completeWithTools).toHaveBeenCalledTimes(2);
  });

  it('handles multiple tool calls in one turn (parallel)', async () => {
    const provider = mockProvider([
      toolCallResponse([
        { id: 'tc1', name: 'echo', input: { message: 'a' } },
        { id: 'tc2', name: 'echo', input: { message: 'b' } },
      ]),
      textResponse('Got both echoes'),
    ]);

    const result = await runAgentLoop('Echo a and b', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
    });

    expect(result.text).toBe('Got both echoes');
    expect(result.iterations).toBe(2);
  });

  it('handles multi-step tool use (3 iterations)', async () => {
    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'echo', input: { message: 'step1' } }]),
      toolCallResponse([{ id: 'tc2', name: 'echo', input: { message: 'step2' } }]),
      textResponse('Done after 2 tool calls'),
    ]);

    const result = await runAgentLoop('Multi-step', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
    });

    expect(result.text).toBe('Done after 2 tool calls');
    expect(result.iterations).toBe(3);
  });

  it('stops at max iterations', async () => {
    // Provider always returns tool calls — never ends
    const infiniteToolCalls = Array.from({ length: 5 }, (_, i) =>
      toolCallResponse([{ id: `tc${i}`, name: 'echo', input: { message: `loop${i}` } }]),
    );
    const provider = mockProvider(infiniteToolCalls);

    const result = await runAgentLoop('Loop forever', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
      maxIterations: 3,
    });

    expect(result.iterations).toBe(3);
    expect(provider.completeWithTools).toHaveBeenCalledTimes(3);
  });

  it('handles unknown tool calls gracefully', async () => {
    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'nonexistent', input: {} }]),
      textResponse('Handled the error'),
    ]);

    const result = await runAgentLoop('Call missing tool', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
    });

    expect(result.text).toBe('Handled the error');
    // Verify the tool_result with error was passed back
    const toolResultMsg = result.messages.find(
      (m) =>
        m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result' && b.is_error),
    );
    expect(toolResultMsg).toBeDefined();
  });

  it('handles tool execution errors gracefully', async () => {
    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'always_fail', input: {} }]),
      textResponse('Recovered from error'),
    ]);

    const result = await runAgentLoop('Fail', [], {
      provider,
      model: 'test-model',
      tools: [failTool],
    });

    expect(result.text).toBe('Recovered from error');
  });

  it('emits events for each phase', async () => {
    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'echo', input: { message: 'test' } }]),
      textResponse('Final answer'),
    ]);

    const events: AgentLoopEvent[] = [];

    await runAgentLoop('Test events', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
      onEvent: (e) => events.push(e),
    });

    const eventTypes = events.map((e) => e.type);
    // First iteration: action + observation (no thought text in tool-only response)
    // Second iteration: thought + done
    expect(eventTypes).toContain('action');
    expect(eventTypes).toContain('observation');
    expect(eventTypes).toContain('thought');
    expect(eventTypes).toContain('done');
  });

  it('emits max_iterations event when limit reached', async () => {
    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'echo', input: { message: 'x' } }]),
      toolCallResponse([{ id: 'tc2', name: 'echo', input: { message: 'x' } }]),
    ]);

    const events: AgentLoopEvent[] = [];

    await runAgentLoop('Loop', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
      maxIterations: 2,
      onEvent: (e) => events.push(e),
    });

    expect(events.some((e) => e.type === 'max_iterations')).toBe(true);
  });

  it('preserves conversation history', async () => {
    const existingHistory: AgentMessage[] = [
      { role: 'user', content: 'Previous message' },
      { role: 'assistant', content: [{ type: 'text', text: 'Previous answer' }] },
    ];

    const provider = mockProvider([textResponse('Continued')]);

    const result = await runAgentLoop('New message', existingHistory, {
      provider,
      model: 'test-model',
    });

    // Messages should include history + new user message + assistant response
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0]).toEqual(existingHistory[0]);
    expect(result.messages[1]).toEqual(existingHistory[1]);
  });

  it('passes system prompt to provider', async () => {
    const provider = mockProvider([textResponse('OK')]);

    await runAgentLoop('Hi', [], {
      provider,
      model: 'test-model',
      systemPrompt: 'You are a helpful assistant',
    });

    expect(provider.completeWithTools).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'You are a helpful assistant' }),
    );
  });

  it('stops early when abort signal is triggered', async () => {
    const ac = new AbortController();
    // Provider returns tool calls then text — but we abort before iteration 2
    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'echo', input: { message: 'step1' } }]),
      textResponse('Should not reach this'),
    ]);

    // Abort after the first iteration completes (we trigger it synchronously before the call)
    // We need the abort to fire between iterations, so abort immediately
    ac.abort();

    const events: AgentLoopEvent[] = [];
    const result = await runAgentLoop('Go', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
      abortSignal: ac.signal,
      onEvent: (e) => events.push(e),
    });

    // Since we aborted before iteration 1, the loop should return immediately
    expect(result.iterations).toBe(1);
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('returns last assistant text when aborted mid-conversation', async () => {
    const ac = new AbortController();

    // Provider returns tool call first, then text, then another tool call
    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'echo', input: { message: 'ping' } }]),
      textResponse('Intermediate answer'),
      toolCallResponse([{ id: 'tc2', name: 'echo', input: { message: 'pong' } }]),
    ]);

    // We'll track iterations via onEvent and abort after iteration 2
    let iterationCount = 0;
    const result = await runAgentLoop('Go', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
      abortSignal: ac.signal,
      onEvent: (e) => {
        // After the second LLM call completes (done event for text), abort
        if (e.type === 'done' || e.type === 'thought') {
          iterationCount++;
          if (iterationCount >= 1) ac.abort();
        }
      },
    });

    // The loop should have stopped; text from last assistant message available
    expect(result.text).toBeDefined();
  });

  it('accumulates usage across iterations', async () => {
    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'echo', input: { message: 'a' } }]),
      textResponse('Done'),
    ]);

    const result = await runAgentLoop('Go', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
    });

    // 2 iterations × 100 input + 50 output each
    expect(result.usage.inputTokens).toBe(200);
    expect(result.usage.outputTokens).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Guard integration tests
// ---------------------------------------------------------------------------

/** In-memory audit log for testing. */
function mockAuditLog(): AuditLog {
  const events: AuditEventInput[] = [];
  return {
    append: (event: AuditEventInput) => events.push(event),
    query: async () => [] as AuditEvent[],
  };
}

/** Guard that blocks a specific tool by name. */
function blockingGuard(blockedTool: string): Guard {
  return {
    name: 'test-blocker',
    check(action: ProposedAction): GuardResult {
      if (action.toolName === blockedTool) {
        return { pass: false, reason: `Tool "${blockedTool}" is blocked by test guard` };
      }
      return { pass: true };
    },
  };
}

/** Tool that returns a secret in its output (for DLP testing). */
const leakyTool: ToolDefinition = {
  name: 'leaky',
  description: 'Returns a secret',
  parameters: z.object({}),
  execute: async () => ({ content: 'Here is a key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA' }),
};

describe('runAgentLoop with guards', () => {
  it('blocks tool execution when guard rejects', async () => {
    const auditLog = mockAuditLog();
    const guardRunner = new GuardRunner([blockingGuard('echo')], { auditLog });

    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'echo', input: { message: 'test' } }]),
      textResponse('Handled the block'),
    ]);

    const result = await runAgentLoop('Echo test', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
      guardRunner,
    });

    expect(result.text).toBe('Handled the block');
    // The tool result should contain the guard block message
    const toolResultMsg = result.messages.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_result' && b.content.includes('Blocked by guard')),
    );
    expect(toolResultMsg).toBeDefined();
  });

  it('allows tool execution when guard passes', async () => {
    const auditLog = mockAuditLog();
    // Guard blocks 'dangerous_tool', but we're calling 'echo' — should pass
    const guardRunner = new GuardRunner([blockingGuard('dangerous_tool')], { auditLog });

    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'echo', input: { message: 'hello' } }]),
      textResponse('Echo succeeded'),
    ]);

    const result = await runAgentLoop('Echo hello', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
      guardRunner,
    });

    expect(result.text).toBe('Echo succeeded');
    // Verify the echo tool actually executed — tool result should contain "Echo: hello"
    const toolResultMsg = result.messages.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_result' && b.content.includes('Echo: hello')),
    );
    expect(toolResultMsg).toBeDefined();
  });

  it('suppresses output when DLP detects a secret', async () => {
    const auditLog = mockAuditLog();
    const guardRunner = new GuardRunner([], { auditLog });
    const outputDlp = new OutputDlpGuard();

    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'leaky', input: {} }]),
      textResponse('Handled the DLP block'),
    ]);

    const result = await runAgentLoop('Leak a secret', [], {
      provider,
      model: 'test-model',
      tools: [leakyTool],
      guardRunner,
      outputDlp,
    });

    expect(result.text).toBe('Handled the DLP block');
    // The tool result should be suppressed by DLP
    const toolResultMsg = result.messages.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_result' && b.content.includes('Output blocked by DLP')),
    );
    expect(toolResultMsg).toBeDefined();
  });

  it('works without guardRunner (backward compatibility)', async () => {
    const provider = mockProvider([
      toolCallResponse([{ id: 'tc1', name: 'echo', input: { message: 'compat' } }]),
      textResponse('Still works'),
    ]);

    const result = await runAgentLoop('Echo compat', [], {
      provider,
      model: 'test-model',
      tools: [echoTool],
      // No guardRunner — plain ToolRegistry path
    });

    expect(result.text).toBe('Still works');
    expect(result.iterations).toBe(2);
  });
});
