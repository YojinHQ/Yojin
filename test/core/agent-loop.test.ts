import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runAgentLoop } from '../../src/core/agent-loop.js';
import type {
  AgentLoopProvider,
  AgentLoopEvent,
  AgentMessage,
  ContentBlock,
  ToolDefinition,
} from '../../src/core/types.js';

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
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === 'tool_result' && b.is_error),
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
