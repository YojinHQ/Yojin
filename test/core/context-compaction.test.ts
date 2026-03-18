import { describe, expect, it, vi } from 'vitest';

import { compactMessages } from '../../src/core/context-compaction.js';
import { TokenBudget } from '../../src/core/token-budget.js';
import type { AgentLoopProvider, AgentMessage } from '../../src/core/types.js';

function mockProvider(summaryText: string = 'Summary of conversation'): AgentLoopProvider {
  return {
    completeWithTools: vi.fn(async () => ({
      content: [{ type: 'text' as const, text: summaryText }],
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 50 },
    })),
  };
}

function failingProvider(): AgentLoopProvider {
  return {
    completeWithTools: vi.fn(async () => {
      throw new Error('LLM unavailable');
    }),
  };
}

function makeMessages(count: number): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({ role: 'user', content: `User message ${i}` });
    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: `Assistant response ${i}` }],
    });
  }
  return messages;
}

describe('compactMessages', () => {
  const budget = new TokenBudget({ contextWindow: 200_000 });

  it('returns messages unchanged when too few to compact', async () => {
    const messages = makeMessages(2); // 4 messages, 2 user turns
    const provider = mockProvider();

    const result = await compactMessages(messages, provider, 'test-model', budget, {
      preserveRecentTurns: 3,
    });

    expect(result.messages).toEqual(messages);
    expect(result.usedLlmSummary).toBe(false);
    expect(result.messagesBefore).toBe(4);
    expect(result.messagesAfter).toBe(4);
  });

  it('compacts old messages and preserves recent turns', async () => {
    const messages = makeMessages(10); // 20 messages, 10 user turns
    const provider = mockProvider('## Decisions\nNone\n## Open TODOs\nNone');

    const result = await compactMessages(messages, provider, 'test-model', budget, {
      preserveRecentTurns: 3,
    });

    expect(result.usedLlmSummary).toBe(true);
    expect(result.messagesAfter).toBeLessThan(result.messagesBefore);
    // Should have: summary user msg + ack assistant msg + preserved recent turns
    // Preserved: last 3 user turns (indices 7,8,9) + their assistant responses = 6 msgs
    // Plus 2 summary messages = 8
    expect(result.messagesAfter).toBe(8);
  });

  it('summary message contains conversation summary text', async () => {
    const messages = makeMessages(10);
    const summaryText = '## Decisions\nWe decided to use TypeScript';
    const provider = mockProvider(summaryText);

    const result = await compactMessages(messages, provider, 'test-model', budget, {
      preserveRecentTurns: 3,
    });

    const firstMsg = result.messages[0];
    expect(firstMsg.role).toBe('user');
    expect(typeof firstMsg.content).toBe('string');
    expect(firstMsg.content as string).toContain(summaryText);
    expect(firstMsg.content as string).toContain('[Previous conversation summary]');
  });

  it('preserves the most recent user messages verbatim', async () => {
    const messages = makeMessages(10);
    const provider = mockProvider();

    const result = await compactMessages(messages, provider, 'test-model', budget, {
      preserveRecentTurns: 3,
    });

    // The last 3 user messages should be preserved verbatim
    const userMessages = result.messages.filter((m) => m.role === 'user');
    const lastUserMsg = userMessages[userMessages.length - 1];
    expect(lastUserMsg.content).toBe('User message 9');
  });

  it('falls back to hard trim when LLM summarization fails', async () => {
    const messages = makeMessages(10);
    const provider = failingProvider();

    const result = await compactMessages(messages, provider, 'test-model', budget, {
      preserveRecentTurns: 3,
    });

    expect(result.usedLlmSummary).toBe(false);
    // Should only have the preserved recent turns (no summary messages)
    expect(result.messagesAfter).toBe(6); // 3 user + 3 assistant
  });

  it('calls provider with summarization prompt', async () => {
    const messages = makeMessages(10);
    const provider = mockProvider();

    await compactMessages(messages, provider, 'test-model', budget, {
      preserveRecentTurns: 3,
    });

    expect(provider.completeWithTools).toHaveBeenCalledTimes(1);
    const call = vi.mocked(provider.completeWithTools).mock.calls[0][0];
    expect(call.system).toContain('conversation summarizer');
    expect(call.messages[0].content).toContain('summarize');
  });

  it('handles conversation with tool use blocks', async () => {
    const messages: AgentMessage[] = [
      { role: 'user', content: 'Search for X' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me search' },
          { type: 'tool_use', id: 'tc1', name: 'search', input: { q: 'X' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'Found: result X' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'I found result X' }],
      },
      // More turns to make it compactable
      ...makeMessages(5),
    ];

    const provider = mockProvider();
    const result = await compactMessages(messages, provider, 'test-model', budget, {
      preserveRecentTurns: 3,
    });

    expect(result.messagesAfter).toBeLessThan(result.messagesBefore);
  });

  it('respects custom preserveRecentTurns', async () => {
    const messages = makeMessages(10);
    const provider = mockProvider();

    const result1 = await compactMessages(messages, provider, 'test-model', budget, {
      preserveRecentTurns: 2,
    });
    const result5 = await compactMessages(messages, provider, 'test-model', budget, {
      preserveRecentTurns: 5,
    });

    // More preserved turns = more messages after compaction
    expect(result5.messagesAfter).toBeGreaterThan(result1.messagesAfter);
  });
});
