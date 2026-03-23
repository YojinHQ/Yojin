import { describe, expect, it } from 'vitest';

import { BM25Index } from '../../src/memory/bm25.js';

describe('BM25Index', () => {
  describe('tokenize', () => {
    it('lowercases and splits on word boundaries', () => {
      const idx = new BM25Index();
      expect(idx.tokenize('AAPL RSI Oversold')).toEqual(['aapl', 'rsi', 'oversold']);
    });

    it('strips stopwords', () => {
      const idx = new BM25Index();
      const tokens = idx.tokenize('the stock is showing a pattern');
      expect(tokens).not.toContain('the');
      expect(tokens).not.toContain('is');
      expect(tokens).not.toContain('a');
      expect(tokens).toContain('stock');
      expect(tokens).toContain('showing');
      expect(tokens).toContain('pattern');
    });

    it('preserves financial terms', () => {
      const idx = new BM25Index();
      const tokens = idx.tokenize('the bull bear buy sell risk earnings');
      expect(tokens).toContain('bull');
      expect(tokens).toContain('bear');
      expect(tokens).toContain('buy');
      expect(tokens).toContain('sell');
      expect(tokens).toContain('risk');
      expect(tokens).toContain('earnings');
    });

    it('handles empty string', () => {
      const idx = new BM25Index();
      expect(idx.tokenize('')).toEqual([]);
    });
  });

  describe('build and search', () => {
    it('returns empty array when no documents indexed', () => {
      const idx = new BM25Index();
      idx.build([]);
      expect(idx.search('anything')).toEqual([]);
    });

    it('ranks exact match highest', () => {
      const idx = new BM25Index();
      idx.build([
        'AAPL earnings beat strong revenue growth',
        'MSFT cloud revenue decline',
        'AAPL RSI oversold after earnings beat',
      ]);

      const results = idx.search('AAPL earnings beat');
      expect(results.length).toBeGreaterThan(0);
      const topIndices = results.slice(0, 2).map((r) => r.index);
      expect(topIndices).toContain(0);
      expect(topIndices).toContain(2);
    });

    it('respects topN limit', () => {
      const idx = new BM25Index();
      idx.build(['doc one', 'doc two', 'doc three', 'doc four']);
      const results = idx.search('doc', 2);
      expect(results).toHaveLength(2);
    });

    it('returns scores in descending order', () => {
      const idx = new BM25Index();
      idx.build([
        'tech sector rotation into growth stocks',
        'tech earnings strong across sector',
        'commodity prices rising wheat corn',
      ]);
      const results = idx.search('tech sector earnings');
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it('scores zero for completely unrelated query', () => {
      const idx = new BM25Index();
      idx.build(['AAPL earnings beat strong growth']);
      const results = idx.search('cryptocurrency bitcoin mining');
      for (const r of results) {
        expect(r.score).toBe(0);
      }
    });

    it('handles single-document index', () => {
      const idx = new BM25Index();
      idx.build(['AAPL bullish RSI oversold']);
      const results = idx.search('AAPL RSI');
      expect(results).toHaveLength(1);
      expect(results[0].index).toBe(0);
      expect(results[0].score).toBeGreaterThan(0);
    });
  });

  describe('score normalization', () => {
    it('returns scores in 0-1 range', () => {
      const index = new BM25Index();
      index.build([
        'apple earnings beat strong revenue growth',
        'oil prices decline global demand weak',
        'tech sector rotation into value stocks',
      ]);
      const results = index.search('apple earnings growth');
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
      expect(results[0].score).toBeGreaterThan(0.5);
    });

    it('returns 0 scores for non-matching documents', () => {
      const index = new BM25Index();
      index.build(['apple earnings beat', 'oil prices decline']);
      const results = index.search('crypto bitcoin blockchain');
      for (const r of results) {
        expect(r.score).toBe(0);
      }
    });
  });

  describe('custom constants', () => {
    it('accepts custom k1 and b', () => {
      const idx = new BM25Index({ k1: 1.5, b: 0.5 });
      idx.build(['test document one', 'test document two']);
      const results = idx.search('test');
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
