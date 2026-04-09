import { describe, expect, it } from 'vitest';

import { snipToolResults } from '../../src/core/snip.js';
import { TokenBudget } from '../../src/core/token-budget.js';
import type { AgentMessage } from '../../src/core/types.js';

function makeToolResultMessage(content: string): AgentMessage {
  return {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'test-id',
        content,
      },
    ],
  };
}

function makeTextMessage(role: 'user' | 'assistant', text: string): AgentMessage {
  return { role, content: text };
}

function buildConversation(turnCount: number, toolResultSize: number): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (let i = 0; i < turnCount; i++) {
    messages.push(makeTextMessage('user', `Question ${i}`));
    messages.push({
      role: 'assistant',
      content: [{ type: 'tool_use', id: `tool-${i}`, name: 'fetch_data', input: {} }],
    });
    messages.push(makeToolResultMessage('x'.repeat(toolResultSize)));
    messages.push(makeTextMessage('assistant', `Answer ${i}`));
  }
  return messages;
}

describe('snipToolResults', () => {
  it('does not snip when under threshold', () => {
    // Small conversation — well under 70% of 200k context
    const messages = buildConversation(3, 100);
    const budget = new TokenBudget({ contextWindow: 200_000 });

    const result = snipToolResults(messages, budget, { preserveRecentTurns: 2 });

    expect(result.snipped).toBe(0);
    expect(result.messages).toBe(messages); // Same reference — no copy
  });

  it('snips old tool results when over threshold', () => {
    // Large tool results that push us over 70% threshold
    // 10 turns * 40k chars each ≈ 400k chars ≈ ~115k tokens (at 4 chars/token * 1.15 safety)
    // That exceeds 70% of 200k = 140k threshold
    const messages = buildConversation(10, 40_000);
    const budget = new TokenBudget({ contextWindow: 200_000 });

    const result = snipToolResults(messages, budget, { preserveRecentTurns: 3 });

    expect(result.snipped).toBeGreaterThan(0);
    // Recent 3 turns should be preserved
    // Old tool results should be snipped
    const snippedContent = result.messages
      .filter((m) => Array.isArray(m.content))
      .flatMap((m) => m.content as Array<{ type: string; content?: string }>)
      .filter((b) => b.type === 'tool_result' && b.content?.includes('snipped'));
    expect(snippedContent.length).toBeGreaterThan(0);
  });

  it('preserves recent turns unsnipped', () => {
    const messages = buildConversation(10, 40_000);
    const budget = new TokenBudget({ contextWindow: 200_000 });

    const result = snipToolResults(messages, budget, { preserveRecentTurns: 3 });

    // Last 3 turns (12 messages each = 36 messages from end)
    // Check that the last tool result is NOT snipped
    const lastToolResult = [...result.messages]
      .reverse()
      .find((m) => Array.isArray(m.content) && m.content.some((b: { type: string }) => b.type === 'tool_result'));
    if (lastToolResult && Array.isArray(lastToolResult.content)) {
      const toolBlock = lastToolResult.content.find((b: { type: string }) => b.type === 'tool_result') as
        | { content: string }
        | undefined;
      expect(toolBlock?.content).not.toContain('snipped');
    }
  });

  it('does not snip small tool results', () => {
    // Tool results under 500 chars should be preserved
    const messages = buildConversation(10, 100);
    // Use a tiny context window to force the threshold
    const budget = new TokenBudget({ contextWindow: 1_000 });

    const result = snipToolResults(messages, budget, { preserveRecentTurns: 2 });

    // Even though we're over threshold, results are too small to snip
    expect(result.snipped).toBe(0);
  });

  it('returns original messages when conversation is too short', () => {
    const messages = [makeTextMessage('user', 'hello')];
    const budget = new TokenBudget({ contextWindow: 1_000 });

    const result = snipToolResults(messages, budget, { preserveRecentTurns: 5 });

    expect(result.snipped).toBe(0);
  });

  it('reports the size trigger when context usage forces a snip', () => {
    const messages = buildConversation(10, 40_000);
    const budget = new TokenBudget({ contextWindow: 200_000 });

    const result = snipToolResults(messages, budget, { preserveRecentTurns: 3 });

    expect(result.snipped).toBeGreaterThan(0);
    expect(result.trigger).toBe('size');
  });

  it('fires count trigger when many large tool results pile up below threshold', () => {
    // 12 turns × ~600-char tool results — large enough to be compactable but
    // small enough that estimated usage stays well under 70% of 200k tokens.
    // Without a count-based trigger this conversation would never snip.
    const messages = buildConversation(12, 600);
    const budget = new TokenBudget({ contextWindow: 200_000 });

    // Sanity check: still well under the 70% size threshold (~140k tokens)
    expect(budget.estimateTotal(messages)).toBeLessThan(140_000);

    const result = snipToolResults(messages, budget, { preserveRecentTurns: 2 });

    // 12 turns − 2 preserved = 10 old turns, each with one >500-char tool result.
    // Count threshold is 8, so the trigger fires.
    expect(result.snipped).toBeGreaterThan(0);
    expect(result.trigger).toBe('count');
  });

  it('does not fire count trigger below threshold', () => {
    // 6 turns × large results — count trigger is 8, so we stay under it
    // and the size threshold is also not met.
    const messages = buildConversation(6, 600);
    const budget = new TokenBudget({ contextWindow: 200_000 });

    const result = snipToolResults(messages, budget, { preserveRecentTurns: 2 });

    expect(result.snipped).toBe(0);
    expect(result.trigger).toBeNull();
    // Same reference — no copy made
    expect(result.messages).toBe(messages);
  });

  it('count trigger ignores small tool results', () => {
    // 20 turns × small (100-char) results — well over count, but every result
    // is below MIN_SNIP_SIZE, so the count check should not include them.
    const messages = buildConversation(20, 100);
    const budget = new TokenBudget({ contextWindow: 200_000 });

    const result = snipToolResults(messages, budget, { preserveRecentTurns: 2 });

    expect(result.snipped).toBe(0);
    expect(result.trigger).toBeNull();
  });
});
