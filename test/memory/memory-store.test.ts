import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SignalMemoryStore } from '../../src/memory/memory-store.js';
import type { MemoryEntry } from '../../src/memory/types.js';

describe('SignalMemoryStore', () => {
  let dir: string;
  let store: SignalMemoryStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memory-'));
    store = new SignalMemoryStore({ role: 'analyst', dataDir: dir });
    await store.initialize();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('store', () => {
    it('creates an entry and returns an id', async () => {
      const id = await store.store({
        tickers: ['AAPL'],
        situation: 'RSI oversold after earnings beat',
        recommendation: 'Bullish — expect 5% upside',
        confidence: 0.8,
      });
      expect(id).toBeTruthy();
      expect(id.length).toBeGreaterThan(0);
    });

    it('persists entry to JSONL file', async () => {
      await store.store({
        tickers: ['AAPL'],
        situation: 'Test situation',
        recommendation: 'Test recommendation',
        confidence: 0.5,
      });

      const content = await readFile(join(dir, 'analyst', 'entries.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const entry = JSON.parse(lines[0]) as MemoryEntry;
      expect(entry.agentRole).toBe('analyst');
      expect(entry.tickers).toEqual(['AAPL']);
      expect(entry.outcome).toBeNull();
    });
  });

  describe('recall', () => {
    it('returns empty array with no entries', async () => {
      const results = await store.recall('anything');
      expect(results).toEqual([]);
    });

    it('retrieves similar entries via BM25', async () => {
      await store.store({
        tickers: ['AAPL'],
        situation: 'AAPL RSI oversold after earnings beat tech sector strong',
        recommendation: 'Bullish',
        confidence: 0.8,
      });
      await store.store({
        tickers: ['MSFT'],
        situation: 'MSFT cloud revenue declining enterprise spending down',
        recommendation: 'Bearish',
        confidence: 0.6,
      });

      const results = await store.recall('AAPL earnings beat RSI oversold');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.tickers).toContain('AAPL');
    });

    it('filters by ticker when provided', async () => {
      await store.store({
        tickers: ['AAPL'],
        situation: 'AAPL earnings beat',
        recommendation: 'Bullish',
        confidence: 0.8,
      });
      await store.store({
        tickers: ['MSFT'],
        situation: 'MSFT earnings beat',
        recommendation: 'Bullish',
        confidence: 0.7,
      });

      const results = await store.recall('earnings beat', { tickers: ['MSFT'] });
      expect(results).toHaveLength(1);
      expect(results[0].entry.tickers).toContain('MSFT');
    });

    it('respects topN limit', async () => {
      for (let i = 0; i < 5; i++) {
        await store.store({
          tickers: ['AAPL'],
          situation: `AAPL situation variant ${i}`,
          recommendation: 'Bullish',
          confidence: 0.5,
        });
      }
      const results = await store.recall('AAPL situation', { topN: 2 });
      expect(results).toHaveLength(2);
    });
  });

  describe('reflect', () => {
    it('updates entry with reflection data', async () => {
      const id = await store.store({
        tickers: ['AAPL'],
        situation: 'Test situation',
        recommendation: 'Bullish',
        confidence: 0.8,
      });

      const result = await store.reflect(id, {
        outcome: 'AAPL rose 5%',
        lesson: 'Earnings beat in risk-on macro is reliable',
        actualReturn: 5.0,
        grade: 'CORRECT',
      });

      expect(result).toEqual({ success: true });

      const results = await store.recall('Test situation');
      expect(results[0].entry.grade).toBe('CORRECT');
      expect(results[0].entry.lesson).toBe('Earnings beat in risk-on macro is reliable');
      expect(results[0].entry.reflectedAt).toBeTruthy();
    });

    it('returns error result for unknown entry id', async () => {
      const result = await store.reflect('nonexistent', {
        outcome: 'Some outcome',
        lesson: 'Some lesson',
        actualReturn: 1.0,
        grade: 'CORRECT',
      });
      expect(result).toEqual({ success: false, error: 'Memory entry not found: nonexistent' });
    });

    it('returns error result when entry is already reflected', async () => {
      const id = await store.store({
        tickers: ['AAPL'],
        situation: 'Test situation',
        recommendation: 'Bullish',
        confidence: 0.8,
      });

      await store.reflect(id, {
        outcome: 'AAPL rose 5%',
        lesson: 'First reflection',
        actualReturn: 5.0,
        grade: 'CORRECT',
      });

      const result = await store.reflect(id, {
        outcome: 'Trying again',
        lesson: 'Second reflection',
        actualReturn: 3.0,
        grade: 'PARTIALLY_CORRECT',
      });

      expect(result).toMatchObject({ success: false });
      expect((result as { success: false; error: string }).error).toMatch(/already reflected/);
    });
  });

  describe('findUnreflected', () => {
    it('returns only unreflected entries', async () => {
      const id1 = await store.store({
        tickers: ['AAPL'],
        situation: 'Situation 1',
        recommendation: 'Bullish',
        confidence: 0.8,
      });
      await store.store({
        tickers: ['MSFT'],
        situation: 'Situation 2',
        recommendation: 'Bearish',
        confidence: 0.6,
      });

      await store.reflect(id1, {
        outcome: 'Rose 5%',
        lesson: 'Good call',
        actualReturn: 5.0,
        grade: 'CORRECT',
      });

      const unreflected = await store.findUnreflected();
      expect(unreflected).toHaveLength(1);
      expect(unreflected[0].tickers).toContain('MSFT');
    });

    it('filters by ticker', async () => {
      await store.store({ tickers: ['AAPL'], situation: 'S1', recommendation: 'R1', confidence: 0.5 });
      await store.store({ tickers: ['MSFT'], situation: 'S2', recommendation: 'R2', confidence: 0.5 });

      const unreflected = await store.findUnreflected({ ticker: 'AAPL' });
      expect(unreflected).toHaveLength(1);
      expect(unreflected[0].tickers).toContain('AAPL');
    });
  });

  describe('prune', () => {
    it('removes oldest reflected entries when over capacity', async () => {
      const smallStore = new SignalMemoryStore({ role: 'analyst', dataDir: dir, maxEntries: 3 });
      await smallStore.initialize();

      const id1 = await smallStore.store({ tickers: ['A'], situation: 'S1', recommendation: 'R1', confidence: 0.5 });
      const id2 = await smallStore.store({ tickers: ['B'], situation: 'S2', recommendation: 'R2', confidence: 0.5 });
      await smallStore.store({ tickers: ['C'], situation: 'S3', recommendation: 'R3', confidence: 0.5 });

      await smallStore.reflect(id1, { outcome: 'O1', lesson: 'L1', actualReturn: 1, grade: 'CORRECT' });
      await smallStore.reflect(id2, { outcome: 'O2', lesson: 'L2', actualReturn: 2, grade: 'CORRECT' });

      await smallStore.store({ tickers: ['D'], situation: 'S4', recommendation: 'R4', confidence: 0.5 });

      const pruned = await smallStore.prune();
      expect(pruned).toBe(1);
    });

    it('persists pruned entries to JSONL so reloads respect the cap', async () => {
      const smallStore = new SignalMemoryStore({ role: 'analyst', dataDir: dir, maxEntries: 3 });
      await smallStore.initialize();

      const id1 = await smallStore.store({ tickers: ['A'], situation: 'S1', recommendation: 'R1', confidence: 0.5 });
      const id2 = await smallStore.store({ tickers: ['B'], situation: 'S2', recommendation: 'R2', confidence: 0.5 });
      await smallStore.store({ tickers: ['C'], situation: 'S3', recommendation: 'R3', confidence: 0.5 });
      await smallStore.store({ tickers: ['D'], situation: 'S4', recommendation: 'R4', confidence: 0.5 });

      await smallStore.reflect(id1, { outcome: 'O1', lesson: 'L1', actualReturn: 1, grade: 'CORRECT' });
      await smallStore.reflect(id2, { outcome: 'O2', lesson: 'L2', actualReturn: 2, grade: 'CORRECT' });

      const pruned = await smallStore.prune();
      expect(pruned).toBe(1);

      // Verify JSONL file only has 3 lines
      const content = await readFile(join(dir, 'analyst', 'entries.jsonl'), 'utf-8');
      const lines = content
        .trim()
        .split('\n')
        .filter((l) => l.trim());
      expect(lines).toHaveLength(3);

      // Verify a fresh store reloads exactly 3 entries
      const reloaded = new SignalMemoryStore({ role: 'analyst', dataDir: dir, maxEntries: 3 });
      await reloaded.initialize();
      // Verify reloaded JSONL still has exactly 3 entries
      const reloadedContent = await readFile(join(dir, 'analyst', 'entries.jsonl'), 'utf-8');
      const reloadedLines = reloadedContent
        .trim()
        .split('\n')
        .filter((l) => l.trim());
      expect(reloadedLines).toHaveLength(3);
    });
  });

  describe('persistence across restarts', () => {
    it('reloads entries from JSONL on initialize', async () => {
      await store.store({
        tickers: ['AAPL'],
        situation: 'Persisted situation',
        recommendation: 'Bullish',
        confidence: 0.8,
      });

      const store2 = new SignalMemoryStore({ role: 'analyst', dataDir: dir });
      await store2.initialize();

      const results = await store2.recall('Persisted situation');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.situation).toBe('Persisted situation');
    });
  });
});
