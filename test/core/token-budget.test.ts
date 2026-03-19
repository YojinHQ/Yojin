import { describe, expect, it } from 'vitest';

import { TokenBudget } from '../../src/core/token-budget.js';
import type { AgentMessage } from '../../src/core/types.js';

describe('TokenBudget', () => {
  it('uses default config when none provided', () => {
    const budget = new TokenBudget();
    expect(budget.contextWindow).toBe(200_000);
  });

  it('accepts custom config', () => {
    const budget = new TokenBudget({ contextWindow: 100_000 });
    expect(budget.contextWindow).toBe(100_000);
  });

  describe('estimateStringTokens', () => {
    it('estimates tokens from string length', () => {
      const budget = new TokenBudget();
      // 100 chars / 4 chars-per-token * 1.15 safety = ~29
      const tokens = budget.estimateStringTokens('a'.repeat(100));
      expect(tokens).toBe(29);
    });

    it('returns at least 1 for non-empty strings', () => {
      const budget = new TokenBudget();
      expect(budget.estimateStringTokens('hi')).toBeGreaterThan(0);
    });
  });

  describe('estimateMessageTokens', () => {
    it('estimates string content message', () => {
      const budget = new TokenBudget();
      const msg: AgentMessage = { role: 'user', content: 'Hello world' };
      const tokens = budget.estimateMessageTokens(msg);
      // overhead (4) + string estimate
      expect(tokens).toBeGreaterThan(4);
    });

    it('estimates message with content blocks', () => {
      const budget = new TokenBudget();
      const msg: AgentMessage = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is the result' },
          { type: 'tool_use', id: 'tc1', name: 'search', input: { query: 'test' } },
        ],
      };
      const tokens = budget.estimateMessageTokens(msg);
      expect(tokens).toBeGreaterThan(10);
    });

    it('estimates message with image block', () => {
      const budget = new TokenBudget();
      const imageData = 'a'.repeat(1000); // simulated base64
      const msg: AgentMessage = {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData } },
          { type: 'text', text: 'Analyze this screenshot' },
        ],
      };
      const tokens = budget.estimateMessageTokens(msg);
      // Should include image data estimate + text estimate + overhead
      expect(tokens).toBeGreaterThan(200);
    });

    it('uses denser estimate for tool results', () => {
      const budget = new TokenBudget();
      const textMsg: AgentMessage = { role: 'user', content: 'a'.repeat(1000) };
      const toolResultMsg: AgentMessage = {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'a'.repeat(1000) }],
      };
      // Tool results use 2 chars/token (denser) vs 4 chars/token for text
      // So same char count → tool result should have MORE estimated tokens
      const textTokens = budget.estimateMessageTokens(textMsg);
      const toolTokens = budget.estimateMessageTokens(toolResultMsg);
      expect(toolTokens).toBeGreaterThan(textTokens);
    });
  });

  describe('estimateTotal', () => {
    it('sums message estimates', () => {
      const budget = new TokenBudget();
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi there' }] },
      ];
      const total = budget.estimateTotal(messages);
      expect(total).toBeGreaterThan(0);
    });

    it('includes system prompt in estimate', () => {
      const budget = new TokenBudget();
      const messages: AgentMessage[] = [{ role: 'user', content: 'Hi' }];
      const withoutSystem = budget.estimateTotal(messages);
      const withSystem = budget.estimateTotal(messages, 'You are a helpful assistant');
      expect(withSystem).toBeGreaterThan(withoutSystem);
    });
  });

  describe('shouldCompact', () => {
    it('returns false when under threshold', () => {
      const budget = new TokenBudget({ contextWindow: 200_000 });
      const messages: AgentMessage[] = [{ role: 'user', content: 'Short message' }];
      expect(budget.shouldCompact(messages)).toBe(false);
    });

    it('returns true when over threshold', () => {
      // Use a tiny context window so a normal message exceeds it
      const budget = new TokenBudget({
        contextWindow: 10,
        compactionThreshold: 0.5,
      });
      const messages: AgentMessage[] = [{ role: 'user', content: 'a'.repeat(200) }];
      expect(budget.shouldCompact(messages)).toBe(true);
    });
  });

  describe('maxToolResultChars', () => {
    it('returns chars based on context window and share', () => {
      const budget = new TokenBudget({
        contextWindow: 200_000,
        maxToolResultShare: 0.3,
      });
      // 200_000 * 0.3 = 60_000 tokens * 2 chars/token = 120_000 chars
      expect(budget.maxToolResultChars()).toBe(120_000);
    });
  });

  describe('remaining', () => {
    it('returns remaining budget', () => {
      const budget = new TokenBudget({ contextWindow: 1000 });
      const messages: AgentMessage[] = [{ role: 'user', content: 'Hi' }];
      const remaining = budget.remaining(messages);
      expect(remaining).toBeLessThan(1000);
      expect(remaining).toBeGreaterThan(0);
    });
  });
});
