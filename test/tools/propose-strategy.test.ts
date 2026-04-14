import { describe, expect, it } from 'vitest';

import { createProposeStrategyTool } from '../../src/tools/propose-strategy.js';

describe('propose-strategy tool', () => {
  const tool = createProposeStrategyTool();

  const validInput = {
    name: 'Mean Reversion on RSI',
    description: 'Buy when RSI < 30, sell when RSI > 70',
    category: 'MARKET',
    style: 'swing',
    content: '## Entry\nBuy when RSI crosses below 30.\n## Exit\nSell when RSI crosses above 70.',
    triggerGroups: [
      {
        label: '',
        conditions: [
          {
            type: 'INDICATOR_THRESHOLD',
            description: 'RSI crosses below 30',
            params: { indicator: 'RSI', threshold: 30, direction: 'crosses_below' },
          },
        ],
      },
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
      style: 'SWING',
      requires: ['technicals'],
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

    const emptyTriggers = await tool.execute({ ...validInput, triggerGroups: [] });
    expect(emptyTriggers.isError).toBe(true);
    expect(emptyTriggers.content).toContain('triggerGroups');
  });

  it('clamps maxPositionSize to 0-1 range', async () => {
    const overMax = await tool.execute({ ...validInput, maxPositionSize: 1.5 });
    expect(overMax.isError).toBeUndefined();
    expect((overMax.displayCard!.data as { maxPositionSize: number }).maxPositionSize).toBe(1);

    const underMin = await tool.execute({ ...validInput, maxPositionSize: -0.3 });
    expect(underMin.isError).toBeUndefined();
    expect((underMin.displayCard!.data as { maxPositionSize: number }).maxPositionSize).toBe(0);
  });

  it('normalizes indicator when description contradicts params', async () => {
    const input = {
      ...validInput,
      triggerGroups: [
        {
          label: '',
          conditions: [
            {
              type: 'INDICATOR_THRESHOLD' as const,
              description: 'MACD histogram crosses above 0 — bullish momentum',
              params: { indicator: 'RSI' as const, threshold: 0, direction: 'crosses_above' as const },
            },
            {
              type: 'INDICATOR_THRESHOLD' as const,
              description: 'Price at or below lower Bollinger Band',
              params: { indicator: 'RSI' as const, threshold: 0, direction: 'below' as const },
            },
            {
              type: 'INDICATOR_THRESHOLD' as const,
              description: 'RSI below 30 — oversold',
              params: { indicator: 'RSI' as const, threshold: 30, direction: 'below' as const },
            },
          ],
        },
      ],
    };

    const result = await tool.execute(input);
    expect(result.isError).toBeUndefined();

    type TriggerGroup = { conditions: { params: Record<string, unknown> }[] };
    const groups = (result.displayCard!.data as { triggerGroups: TriggerGroup[] }).triggerGroups;
    // MACD description → corrected from RSI to MACD
    expect(groups[0].conditions[0].params.indicator).toBe('MACD');
    // Bollinger description → corrected from RSI to BB_LOWER
    expect(groups[0].conditions[1].params.indicator).toBe('BB_LOWER');
    // RSI description + RSI param → no correction
    expect(groups[0].conditions[2].params.indicator).toBe('RSI');
  });

  it('defaults tickers to empty array and auto-derives requires', async () => {
    const { tickers: _tickers, ...rest } = validInput;
    const result = await tool.execute(rest);

    expect(result.isError).toBeUndefined();
    const data = result.displayCard!.data as { tickers: string[]; requires: string[] };
    expect(data.tickers).toEqual([]);
    expect(data.requires).toEqual(['technicals']);
    expect(result.content).toContain('all portfolio tickers');
  });
});
