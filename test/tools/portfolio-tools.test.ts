import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolDefinition } from '../../src/core/types.js';
import { PortfolioSnapshotStore } from '../../src/portfolio/snapshot-store.js';
import { createPortfolioTools } from '../../src/tools/portfolio-tools.js';

describe('Portfolio tools', () => {
  let tmpDir: string;
  let store: PortfolioSnapshotStore;
  let tools: ToolDefinition[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'yojin-portfolio-tools-'));
    store = new PortfolioSnapshotStore(tmpDir);
    tools = createPortfolioTools({ snapshotStore: store });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates two tools', () => {
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(['get_portfolio', 'save_portfolio_positions']);
  });

  describe('save_portfolio_positions', () => {
    it('saves positions and returns summary', async () => {
      const saveTool = tools.find((t) => t.name === 'save_portfolio_positions')!;
      const result = await saveTool.execute({
        platform: 'COINBASE',
        positions: [
          { symbol: 'BTC', name: 'Bitcoin', quantity: 1, costBasis: 50000, currentPrice: 67000, marketValue: 67000 },
          { symbol: 'ETH', name: 'Ethereum', quantity: 10, costBasis: 2000, currentPrice: 3500, marketValue: 35000 },
        ],
      });

      expect(result.content).toContain('Portfolio saved successfully');
      expect(result.content).toContain('Positions: 2');
      expect(result.content).toContain('COINBASE');
      expect(result.isError).toBeUndefined();

      // Verify persisted
      const snapshot = await store.getLatest();
      expect(snapshot).not.toBeNull();
      expect(snapshot!.positions).toHaveLength(2);
      expect(snapshot!.positions[0].symbol).toBe('BTC');
    });

    it('uppercases symbols', async () => {
      const saveTool = tools.find((t) => t.name === 'save_portfolio_positions')!;
      await saveTool.execute({
        platform: 'ROBINHOOD',
        positions: [
          { symbol: 'aapl', name: 'Apple', quantity: 10, costBasis: 150, currentPrice: 180, marketValue: 1800 },
        ],
      });

      const snapshot = await store.getLatest();
      expect(snapshot!.positions[0].symbol).toBe('AAPL');
    });

    it('accepts empty positions array to clear a platform', async () => {
      const saveTool = tools.find((t) => t.name === 'save_portfolio_positions')!;

      // First save some positions
      await saveTool.execute({
        platform: 'COINBASE',
        positions: [
          { symbol: 'BTC', name: 'Bitcoin', quantity: 1, costBasis: 50000, currentPrice: 67000, marketValue: 67000 },
        ],
      });

      // Clear by saving empty positions for that platform
      const result = await saveTool.execute({
        platform: 'COINBASE',
        positions: [],
      });

      expect(result.content).toContain('Portfolio saved successfully');
      expect(result.content).toContain('Positions: 0');

      const snapshot = await store.getLatest();
      expect(snapshot).not.toBeNull();
      expect(snapshot!.positions).toHaveLength(0);
    });

    it('computes missing market value', async () => {
      const saveTool = tools.find((t) => t.name === 'save_portfolio_positions')!;
      await saveTool.execute({
        platform: 'MANUAL',
        positions: [{ symbol: 'TSLA', quantity: 5, currentPrice: 200 }],
      });

      const snapshot = await store.getLatest();
      expect(snapshot!.positions[0].marketValue).toBe(1000);
    });
  });

  describe('get_portfolio', () => {
    it('returns empty message when no data', async () => {
      const getTool = tools.find((t) => t.name === 'get_portfolio')!;
      const result = await getTool.execute({});

      expect(result.content).toContain('No portfolio data found');
    });

    it('returns current portfolio after save', async () => {
      const saveTool = tools.find((t) => t.name === 'save_portfolio_positions')!;
      const getTool = tools.find((t) => t.name === 'get_portfolio')!;

      await saveTool.execute({
        platform: 'COINBASE',
        positions: [
          { symbol: 'BTC', name: 'Bitcoin', quantity: 1, costBasis: 50000, currentPrice: 67000, marketValue: 67000 },
        ],
      });

      const result = await getTool.execute({});
      expect(result.content).toContain('BTC');
      expect(result.content).toContain('ALL');
      expect(result.content).toContain('Total Value');
    });

    it('exposes exact dollar amounts and quantities to the LLM', async () => {
      const saveTool = tools.find((t) => t.name === 'save_portfolio_positions')!;
      const getTool = tools.find((t) => t.name === 'get_portfolio')!;

      await saveTool.execute({
        platform: 'COINBASE',
        positions: [
          { symbol: 'BTC', name: 'Bitcoin', quantity: 1, costBasis: 50000, currentPrice: 67000, marketValue: 67000 },
          { symbol: 'ETH', name: 'Ethereum', quantity: 10, costBasis: 2000, currentPrice: 3500, marketValue: 35000 },
        ],
      });

      const getResult = await getTool.execute({});
      expect(getResult.content).toContain('$67,000');
      expect(getResult.content).toContain('$35,000');
      expect(getResult.content).toContain('$102,000');
      expect(getResult.content).toContain('1 units');
      expect(getResult.content).toContain('10 units');
    });

    it('save response includes exact totals', async () => {
      const saveTool = tools.find((t) => t.name === 'save_portfolio_positions')!;

      const result = await saveTool.execute({
        platform: 'COINBASE',
        positions: [
          { symbol: 'BTC', name: 'Bitcoin', quantity: 1, costBasis: 50000, currentPrice: 67000, marketValue: 67000 },
        ],
      });

      expect(result.content).toContain('$67,000');
      expect(result.content).toContain('Total P&L: +$17,000');
    });
  });
});
