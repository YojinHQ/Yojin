import { describe, expect, it, vi } from 'vitest';

import type { SignalMemoryStore } from '../../src/memory/memory-store.js';
import { createMemoryTools } from '../../src/memory/tools.js';
import type { MemoryAgentRole } from '../../src/memory/types.js';
import type { PiiRedactor } from '../../src/trust/pii/types.js';

type MockStore = {
  [K in keyof SignalMemoryStore]: ReturnType<typeof vi.fn>;
};

function makeMockStore(): MockStore {
  return {
    store: vi.fn().mockResolvedValue('mock-id'),
    recall: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    reflect: vi.fn(),
    findUnreflected: vi.fn().mockResolvedValue([]),
    initialize: vi.fn(),
    prune: vi.fn(),
  };
}

function makeMockRedactor(): PiiRedactor {
  return {
    redact: vi.fn(<T extends Record<string, unknown>>(data: T) => ({
      data,
      metadata: { fieldsRedacted: 0, rulesApplied: [], hash: '' },
    })),
    addRule: vi.fn(),
    getStats: vi.fn().mockReturnValue({ fieldsRedacted: 0, callsProcessed: 0 }),
  };
}

function makeStores(entries: [MemoryAgentRole, MockStore][]): Map<MemoryAgentRole, SignalMemoryStore> {
  return new Map(entries) as unknown as Map<MemoryAgentRole, SignalMemoryStore>;
}

describe('createMemoryTools', () => {
  it('returns two tools', () => {
    const tools = createMemoryTools({
      stores: makeStores([['analyst', makeMockStore()]]),
      piiRedactor: makeMockRedactor(),
    });
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['store_signal_memory', 'recall_signal_memories']);
  });

  describe('store_signal_memory', () => {
    it('stores a memory and returns structured { id } result', async () => {
      const store = makeMockStore();
      const tools = createMemoryTools({
        stores: makeStores([['analyst', store]]),
        piiRedactor: makeMockRedactor(),
      });
      const storeTool = tools.find((t) => t.name === 'store_signal_memory')!;

      const result = await storeTool.execute({
        agentRole: 'analyst',
        tickers: ['AAPL'],
        situation: 'RSI oversold',
        recommendation: 'Bullish',
        confidence: 0.8,
      });

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content);
      expect(parsed).toEqual({ id: 'mock-id' });
      expect(store.store).toHaveBeenCalled();
    });

    it('returns error for unknown role', async () => {
      const tools = createMemoryTools({
        stores: makeStores([]),
        piiRedactor: makeMockRedactor(),
      });
      const storeTool = tools.find((t) => t.name === 'store_signal_memory')!;

      const result = await storeTool.execute({
        agentRole: 'analyst',
        tickers: ['AAPL'],
        situation: 'Test',
        recommendation: 'Test',
        confidence: 0.5,
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('recall_signal_memories', () => {
    it('returns formatted recall results', async () => {
      const store = makeMockStore();
      store.recall.mockResolvedValue([
        {
          entry: {
            id: 'e1',
            situation: 'AAPL RSI oversold',
            recommendation: 'Bullish',
            confidence: 0.8,
            grade: 'CORRECT',
            lesson: 'Good call',
            actualReturn: 5.0,
            createdAt: '2026-03-15T10:00:00Z',
            tickers: ['AAPL'],
            outcome: 'Rose 5%',
          },
          score: 0.85,
        },
      ]);

      const tools = createMemoryTools({
        stores: makeStores([['analyst', store]]),
        piiRedactor: makeMockRedactor(),
      });
      const recallTool = tools.find((t) => t.name === 'recall_signal_memories')!;

      const result = await recallTool.execute({
        agentRole: 'analyst',
        situation: 'AAPL RSI oversold',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('AAPL');
      expect(result.content).toContain('Bullish');
    });

    it('returns no-results message when empty', async () => {
      const store = makeMockStore();
      const tools = createMemoryTools({
        stores: makeStores([['analyst', store]]),
        piiRedactor: makeMockRedactor(),
      });
      const recallTool = tools.find((t) => t.name === 'recall_signal_memories')!;

      const result = await recallTool.execute({
        agentRole: 'analyst',
        situation: 'Some query',
      });

      expect(result.content).toContain('No matching memories');
    });
  });
});
