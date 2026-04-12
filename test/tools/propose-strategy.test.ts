import { describe, expect, it } from 'vitest';

import { createProposeStrategyTool } from '../../src/tools/propose-strategy.js';

describe('propose-strategy tool', () => {
  const tool = createProposeStrategyTool();

  const validInput = {
    name: 'Mean Reversion on RSI',
    description: 'Buy when RSI < 30, sell when RSI > 70',
    category: 'MARKET',
    style: 'swing',
    requires: ['technicals', 'market_data'],
    content: '## Entry\nBuy when RSI crosses below 30.\n## Exit\nSell when RSI crosses above 70.',
    triggers: [
      { type: 'INDICATOR_THRESHOLD', description: 'RSI crosses below 30', params: { indicator: 'RSI', threshold: 30 } },
    ],
    tickers: ['AAPL', 'MSFT'],
    maxPositionSize: 0.05,
  };

  it('returns a strategy-proposal display card with valid input', async () => {
    const result = await tool.execute(validInput);

    expect(result.isError).toBeUndefined();
    expect(result.displayCard).toBeDefined();
    expect(result.displayCard!.type).toBe('strategy-proposal');

    const data = result.displayCard!.data;
    expect(data).toMatchObject({
      name: 'Mean Reversion on RSI',
      category: 'MARKET',
      style: 'swing',
      requires: ['technicals', 'market_data'],
      tickers: ['AAPL', 'MSFT'],
      maxPositionSize: 0.05,
    });

    expect(result.content).toContain('Mean Reversion on RSI');
    expect(result.content).toContain('AAPL, MSFT');
  });

  it('returns error for missing required fields', async () => {
    const missingName = await tool.execute({ ...validInput, name: '' });
    expect(missingName.isError).toBe(true);
    expect(missingName.content).toContain('name');

    const emptyTriggers = await tool.execute({ ...validInput, triggers: [] });
    expect(emptyTriggers.isError).toBe(true);
    expect(emptyTriggers.content).toContain('triggers');
  });

  it('clamps maxPositionSize to 0-1 range', async () => {
    const overMax = await tool.execute({ ...validInput, maxPositionSize: 1.5 });
    expect(overMax.isError).toBeUndefined();
    expect((overMax.displayCard!.data as { maxPositionSize: number }).maxPositionSize).toBe(1);

    const underMin = await tool.execute({ ...validInput, maxPositionSize: -0.3 });
    expect(underMin.isError).toBeUndefined();
    expect((underMin.displayCard!.data as { maxPositionSize: number }).maxPositionSize).toBe(0);
  });

  it('defaults tickers and requires to empty arrays', async () => {
    const { tickers: _tickers, requires: _requires, ...rest } = validInput;
    const result = await tool.execute(rest);

    expect(result.isError).toBeUndefined();
    const data = result.displayCard!.data as { tickers: string[]; requires: string[] };
    expect(data.tickers).toEqual([]);
    expect(data.requires).toEqual([]);
    expect(result.content).toContain('all portfolio tickers');
  });
});
