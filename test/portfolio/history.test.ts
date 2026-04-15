import type { TickerPriceHistory } from '@yojinhq/jintel-client';
import { describe, expect, it } from 'vitest';

import type { Position } from '../../src/api/graphql/types.js';
import {
  buildHistoryPoints,
  buildPriceMap,
  daysToJintelRange,
  fillCalendarDays,
  resolvePositionStartDates,
} from '../../src/portfolio/history.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTicker(ticker: string, entries: { date: string; close: number }[]): TickerPriceHistory {
  return {
    ticker,
    history: entries.map(({ date, close }) => ({
      date,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1000,
    })),
  };
}

function makePosition(
  overrides: Partial<Position> & Pick<Position, 'symbol' | 'platform' | 'quantity' | 'costBasis'>,
): Position {
  return {
    name: overrides.symbol,
    currentPrice: 0,
    marketValue: 0,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    assetClass: 'EQUITY' as Position['assetClass'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildPriceMap
// ---------------------------------------------------------------------------

describe('buildPriceMap', () => {
  it('builds symbol → date → close price map from Jintel response (multi-ticker)', () => {
    const data: TickerPriceHistory[] = [
      makeTicker('AAPL', [
        { date: '2026-04-01', close: 150 },
        { date: '2026-04-02', close: 152 },
      ]),
      makeTicker('TSLA', [{ date: '2026-04-01', close: 200 }]),
    ];

    const map = buildPriceMap(data);

    expect(map.size).toBe(2);
    expect(map.get('AAPL')?.get('2026-04-01')).toBe(150);
    expect(map.get('AAPL')?.get('2026-04-02')).toBe(152);
    expect(map.get('TSLA')?.get('2026-04-01')).toBe(200);
  });

  it('returns empty map for empty input', () => {
    const map = buildPriceMap([]);
    expect(map.size).toBe(0);
  });

  it('normalizes date strings with timestamps to YYYY-MM-DD', () => {
    const data: TickerPriceHistory[] = [makeTicker('AAPL', [{ date: '2026-04-01 16:00:00', close: 150 }])];

    const map = buildPriceMap(data);
    expect(map.get('AAPL')?.get('2026-04-01')).toBe(150);
    expect(map.get('AAPL')?.has('2026-04-01 16:00:00')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fillCalendarDays
// ---------------------------------------------------------------------------

describe('fillCalendarDays', () => {
  it('fills weekend gaps by carrying forward last close (Friday→Sat→Sun→Monday)', () => {
    // Friday=04-04, Saturday=04-05, Sunday=04-06, Monday=04-07
    const priceMap = new Map<string, Map<string, number>>([
      [
        'AAPL',
        new Map([
          ['2026-04-03', 150],
          ['2026-04-04', 152], // Friday
          // Sat/Sun missing
          ['2026-04-07', 155], // Monday
        ]),
      ],
    ]);

    const filled = fillCalendarDays(priceMap, '2026-04-03', '2026-04-07');
    const aapl = filled.get('AAPL')!;

    expect(aapl.get('2026-04-04')).toBe(152); // Friday
    expect(aapl.get('2026-04-05')).toBe(152); // Saturday — carried forward
    expect(aapl.get('2026-04-06')).toBe(152); // Sunday — carried forward
    expect(aapl.get('2026-04-07')).toBe(155); // Monday — real price
  });

  it('handles multiple symbols with different trading days', () => {
    const priceMap = new Map<string, Map<string, number>>([
      // Equity — only weekdays
      [
        'AAPL',
        new Map([
          ['2026-04-04', 152], // Friday
        ]),
      ],
      // Crypto — also has weekend
      [
        'BTC',
        new Map([
          ['2026-04-04', 80000],
          ['2026-04-05', 81000], // Saturday
          ['2026-04-06', 82000], // Sunday
        ]),
      ],
    ]);

    const filled = fillCalendarDays(priceMap, '2026-04-04', '2026-04-06');

    expect(filled.get('AAPL')?.get('2026-04-05')).toBe(152); // carried
    expect(filled.get('BTC')?.get('2026-04-05')).toBe(81000); // real
    expect(filled.get('BTC')?.get('2026-04-06')).toBe(82000); // real
  });

  it('skips days before first available price for a symbol', () => {
    const priceMap = new Map<string, Map<string, number>>([['AAPL', new Map([['2026-04-03', 150]])]]);

    const filled = fillCalendarDays(priceMap, '2026-04-01', '2026-04-03');
    const aapl = filled.get('AAPL')!;

    expect(aapl.has('2026-04-01')).toBe(false);
    expect(aapl.has('2026-04-02')).toBe(false);
    expect(aapl.get('2026-04-03')).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// buildHistoryPoints
// ---------------------------------------------------------------------------

describe('buildHistoryPoints', () => {
  it('computes daily totalValue from quantity × closePrice', () => {
    const positions: Position[] = [
      makePosition({ symbol: 'AAPL', platform: 'ROBINHOOD', quantity: 10, costBasis: 140 }),
    ];
    const filledPrices = new Map([
      [
        'AAPL',
        new Map([
          ['2026-04-01', 150],
          ['2026-04-02', 160],
        ]),
      ],
    ]);
    const startDates = new Map([['AAPL:ROBINHOOD', '2026-04-01']]);

    const points = buildHistoryPoints(positions, filledPrices, startDates, '2026-04-01', '2026-04-02');

    expect(points).toHaveLength(2);
    expect(points[0].totalValue).toBe(1500); // 10 × 150
    expect(points[1].totalValue).toBe(1600); // 10 × 160
  });

  it('computes periodPnl as value delta minus cost delta', () => {
    const positions: Position[] = [
      makePosition({ symbol: 'AAPL', platform: 'ROBINHOOD', quantity: 10, costBasis: 140 }),
    ];
    const filledPrices = new Map([
      [
        'AAPL',
        new Map([
          ['2026-04-01', 150],
          ['2026-04-02', 160],
        ]),
      ],
    ]);
    const startDates = new Map([['AAPL:ROBINHOOD', '2026-04-01']]);

    const points = buildHistoryPoints(positions, filledPrices, startDates, '2026-04-01', '2026-04-02');

    // day 0: periodPnl = 0 (first point)
    expect(points[0].periodPnl).toBe(0);
    // day 1: valueChange=100, costChange=0, periodPnl=100
    expect(points[1].periodPnl).toBe(100);
    expect(points[1].periodPnlPercent).toBeCloseTo((100 / 1500) * 100, 5);
  });

  it('excludes positions before their startDate', () => {
    const positions: Position[] = [
      makePosition({ symbol: 'AAPL', platform: 'ROBINHOOD', quantity: 10, costBasis: 140 }),
    ];
    const filledPrices = new Map([
      [
        'AAPL',
        new Map([
          ['2026-04-01', 150],
          ['2026-04-02', 160],
        ]),
      ],
    ]);
    // Position starts on day 2
    const startDates = new Map([['AAPL:ROBINHOOD', '2026-04-02']]);

    const points = buildHistoryPoints(positions, filledPrices, startDates, '2026-04-01', '2026-04-02');

    expect(points[0].totalValue).toBe(0); // excluded
    expect(points[1].totalValue).toBe(1600); // included
  });

  it('subtracts cost delta when new position enters', () => {
    const pos1 = makePosition({ symbol: 'AAPL', platform: 'ROBINHOOD', quantity: 10, costBasis: 140 });
    const pos2 = makePosition({ symbol: 'TSLA', platform: 'ROBINHOOD', quantity: 5, costBasis: 200 });

    const filledPrices = new Map([
      [
        'AAPL',
        new Map([
          ['2026-04-01', 150],
          ['2026-04-02', 155],
        ]),
      ],
      [
        'TSLA',
        new Map([
          ['2026-04-01', 210],
          ['2026-04-02', 215],
        ]),
      ],
    ]);
    // AAPL from day 1, TSLA enters on day 2
    const startDates = new Map([
      ['AAPL:ROBINHOOD', '2026-04-01'],
      ['TSLA:ROBINHOOD', '2026-04-02'],
    ]);

    const points = buildHistoryPoints([pos1, pos2], filledPrices, startDates, '2026-04-01', '2026-04-02');

    // Day 1: only AAPL. value=1500, cost=1400
    expect(points[0].totalValue).toBe(1500);
    expect(points[0].totalCost).toBe(1400);

    // Day 2: AAPL value=1550, TSLA value=1075, total=2625; cost=1400+1000=2400
    expect(points[1].totalValue).toBe(2625);
    expect(points[1].totalCost).toBe(2400);

    // periodPnl = valueChange - costChange = (2625-1500) - (2400-1400) = 1125 - 1000 = 125
    expect(points[1].periodPnl).toBe(125);
  });

  it('handles zero previous value without division by zero', () => {
    const positions: Position[] = [
      makePosition({ symbol: 'AAPL', platform: 'ROBINHOOD', quantity: 10, costBasis: 140 }),
    ];
    const filledPrices = new Map([
      // No price on day 1, price on day 2
      ['AAPL', new Map([['2026-04-02', 150]])],
    ]);
    const startDates = new Map([['AAPL:ROBINHOOD', '2026-04-01']]);

    const points = buildHistoryPoints(positions, filledPrices, startDates, '2026-04-01', '2026-04-02');

    // Day 1: no price → position skipped → value=0, cost=0
    expect(points[0].totalValue).toBe(0);
    expect(points[0].totalCost).toBe(0);
    // Day 2: price available → value=1500, cost=1400
    expect(points[1].totalValue).toBe(1500);
    expect(points[1].periodPnlPercent).toBe(0); // prevValue was 0, no division
  });

  it('returns points with totalValue=0 when no prices available', () => {
    const positions: Position[] = [
      makePosition({ symbol: 'AAPL', platform: 'ROBINHOOD', quantity: 10, costBasis: 140 }),
    ];
    const filledPrices = new Map<string, Map<string, number>>(); // empty
    const startDates = new Map([['AAPL:ROBINHOOD', '2026-04-01']]);

    const points = buildHistoryPoints(positions, filledPrices, startDates, '2026-04-01', '2026-04-01');

    expect(points).toHaveLength(1);
    expect(points[0].totalValue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolvePositionStartDates
// ---------------------------------------------------------------------------

describe('resolvePositionStartDates', () => {
  it('uses entryDate when available', () => {
    const positions: Position[] = [
      makePosition({ symbol: 'AAPL', platform: 'ROBINHOOD', quantity: 10, costBasis: 140, entryDate: '2026-01-15' }),
    ];

    const result = resolvePositionStartDates(positions, null, '2026-01-01');
    expect(result.get('AAPL:ROBINHOOD')).toBe('2026-01-15');
  });

  it('falls back to timeline map when entryDate is missing', () => {
    const positions: Position[] = [
      makePosition({ symbol: 'TSLA', platform: 'ROBINHOOD', quantity: 5, costBasis: 200 }),
    ];
    const timeline = new Map([['TSLA', '2026-02-10']]);

    const result = resolvePositionStartDates(positions, timeline, '2026-01-01');
    expect(result.get('TSLA:ROBINHOOD')).toBe('2026-02-10');
  });

  it('uses fallbackDate when both entryDate and timeline are missing', () => {
    const positions: Position[] = [
      makePosition({ symbol: 'BTC', platform: 'COINBASE', quantity: 1, costBasis: 70000 }),
    ];

    const result = resolvePositionStartDates(positions, null, '2026-03-01');
    expect(result.get('BTC:COINBASE')).toBe('2026-03-01');
  });
});

// ---------------------------------------------------------------------------
// daysToJintelRange
// ---------------------------------------------------------------------------

describe('daysToJintelRange', () => {
  it('maps 7→1m, 30→3m, 90→6m, 180→1y, 365→2y', () => {
    expect(daysToJintelRange(7)).toBe('1m');
    expect(daysToJintelRange(30)).toBe('3m');
    expect(daysToJintelRange(90)).toBe('6m');
    expect(daysToJintelRange(180)).toBe('1y');
    expect(daysToJintelRange(365)).toBe('2y');
  });

  it('maps undefined/null to 1m', () => {
    expect(daysToJintelRange(undefined)).toBe('1m');
    expect(daysToJintelRange(null)).toBe('1m');
  });
});
