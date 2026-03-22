import { describe, expect, it, vi } from 'vitest';

import type { SignalMemoryStore } from '../../src/memory/memory-store.js';
import { ReflectionEngine } from '../../src/memory/reflection.js';
import type { LlmProvider, MemoryAgentRole, MemoryEntry, PriceOutcome, PriceProvider } from '../../src/memory/types.js';

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'test-id',
    agentRole: 'analyst',
    tickers: ['AAPL'],
    situation: 'RSI oversold after earnings beat',
    recommendation: 'Bullish — expect upside',
    confidence: 0.8,
    createdAt: '2026-03-15T10:00:00Z',
    outcome: null,
    lesson: null,
    actualReturn: null,
    grade: null,
    reflectedAt: null,
    ...overrides,
  };
}

type MockStore = {
  [K in keyof SignalMemoryStore]: ReturnType<typeof vi.fn>;
};

function makeMockStore(): MockStore {
  return {
    reflect: vi.fn(),
    findUnreflected: vi.fn().mockResolvedValue([]),
    recall: vi.fn().mockResolvedValue([]),
    store: vi.fn(),
    initialize: vi.fn(),
    prune: vi.fn(),
  };
}

function makePriceProvider(returnPct: number): PriceProvider {
  return vi.fn().mockResolvedValue({
    priceAtAnalysis: 150,
    priceNow: 150 * (1 + returnPct / 100),
    returnPct,
    highInPeriod: 160,
    lowInPeriod: 145,
  } satisfies PriceOutcome);
}

function makeMockProvider(): LlmProvider {
  return {
    completeWithTools: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Lesson: RSI was unreliable in macro headwinds' }],
      stopReason: 'end_turn',
    }),
  };
}

function makeStores(entries: [MemoryAgentRole, MockStore][]): Map<MemoryAgentRole, SignalMemoryStore> {
  return new Map(entries) as Map<MemoryAgentRole, SignalMemoryStore>;
}

describe('ReflectionEngine', () => {
  describe('reflectOnEntry', () => {
    it('grades bullish + positive return as CORRECT', async () => {
      const store = makeMockStore();
      const engine = new ReflectionEngine({
        providerRouter: makeMockProvider(),
        memoryStores: makeStores([['analyst', store]]),
        priceProvider: makePriceProvider(5.0),
      });

      const result = await engine.reflectOnEntry(makeEntry());
      expect(result.success).toBe(true);
      expect(store.reflect).toHaveBeenCalledWith('test-id', expect.objectContaining({ grade: 'CORRECT' }));
    });

    it('grades bullish + negative return as INCORRECT', async () => {
      const store = makeMockStore();
      const engine = new ReflectionEngine({
        providerRouter: makeMockProvider(),
        memoryStores: makeStores([['analyst', store]]),
        priceProvider: makePriceProvider(-5.0),
      });

      const result = await engine.reflectOnEntry(makeEntry());
      expect(result.success).toBe(true);
      expect(store.reflect).toHaveBeenCalledWith('test-id', expect.objectContaining({ grade: 'INCORRECT' }));
    });

    it('grades bearish + negative return as CORRECT', async () => {
      const store = makeMockStore();
      const engine = new ReflectionEngine({
        providerRouter: makeMockProvider(),
        memoryStores: makeStores([['analyst', store]]),
        priceProvider: makePriceProvider(-3.0),
      });

      const entry = makeEntry({ recommendation: 'Bearish — expect downside' });
      const result = await engine.reflectOnEntry(entry);
      expect(result.success).toBe(true);
      expect(store.reflect).toHaveBeenCalledWith('test-id', expect.objectContaining({ grade: 'CORRECT' }));
    });

    it('returns success for already-reflected entries (no-op)', async () => {
      const store = makeMockStore();
      const engine = new ReflectionEngine({
        providerRouter: makeMockProvider(),
        memoryStores: makeStores([['analyst', store]]),
        priceProvider: makePriceProvider(5.0),
      });

      const entry = makeEntry({ reflectedAt: '2026-03-22T10:00:00Z', grade: 'CORRECT' });
      const result = await engine.reflectOnEntry(entry);
      expect(result).toEqual({ success: true });
      expect(store.reflect).not.toHaveBeenCalled();
    });

    it('returns price_unavailable when price provider throws', async () => {
      const store = makeMockStore();
      const failingProvider: PriceProvider = vi.fn().mockRejectedValue(new Error('No data'));
      const engine = new ReflectionEngine({
        providerRouter: makeMockProvider(),
        memoryStores: makeStores([['analyst', store]]),
        priceProvider: failingProvider,
      });

      const result = await engine.reflectOnEntry(makeEntry());
      expect(result).toEqual({ success: false, reason: 'price_unavailable', entryId: 'test-id' });
    });

    it('returns llm_error when LLM call fails', async () => {
      const store = makeMockStore();
      const failingLlm: LlmProvider = {
        completeWithTools: vi.fn().mockRejectedValue(new Error('Rate limited')),
      };
      const engine = new ReflectionEngine({
        providerRouter: failingLlm,
        memoryStores: makeStores([['analyst', store]]),
        priceProvider: makePriceProvider(5.0),
      });

      const result = await engine.reflectOnEntry(makeEntry());
      expect(result).toEqual({ success: false, reason: 'llm_error', entryId: 'test-id' });
    });
  });

  describe('runSweep', () => {
    it('reflects on all unreflected entries across stores', async () => {
      const entry1 = makeEntry({ id: 'e1', agentRole: 'analyst' });
      const entry2 = makeEntry({ id: 'e2', agentRole: 'strategist' });

      const store1 = makeMockStore();
      store1.findUnreflected.mockResolvedValue([entry1]);
      const store2 = makeMockStore();
      store2.findUnreflected.mockResolvedValue([entry2]);

      const engine = new ReflectionEngine({
        providerRouter: makeMockProvider(),
        memoryStores: makeStores([
          ['analyst', store1],
          ['strategist', store2],
        ]),
        priceProvider: makePriceProvider(3.0),
      });

      const result = await engine.runSweep({ olderThanDays: 7 });
      expect(result.reflected).toBe(2);
      expect(result.errors).toBe(0);
    });
  });

  describe('reflectOnRevisit', () => {
    it('reflects on unreflected entries for a specific ticker', async () => {
      const entry = makeEntry({ id: 'e1' });
      const store = makeMockStore();
      store.findUnreflected.mockResolvedValue([entry]);
      store.recall.mockResolvedValue([{ entry: { ...entry, reflectedAt: '2026-03-22T10:00:00Z' }, score: 0.9 }]);

      const engine = new ReflectionEngine({
        providerRouter: makeMockProvider(),
        memoryStores: makeStores([['analyst', store]]),
        priceProvider: makePriceProvider(5.0),
      });

      const lessons = await engine.reflectOnRevisit('analyst', 'AAPL');
      expect(lessons).toHaveLength(1);
      expect(store.reflect).toHaveBeenCalled();
    });
  });
});
