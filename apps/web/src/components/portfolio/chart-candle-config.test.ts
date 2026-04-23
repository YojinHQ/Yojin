import { describe, it, expect } from 'vitest';
import { CANDLE_CONFIG, INTRADAY_CANDLES, PERIOD_CANDLES, type Candle } from './chart-candle-config';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('CANDLE_CONFIG', () => {
  it('defines exactly the six expected candles', () => {
    const keys: Candle[] = ['15m', '30m', '1h', '1d', '1wk', '1mo'];
    expect(Object.keys(CANDLE_CONFIG).sort()).toEqual([...keys].sort());
  });

  it('maps each candle to the documented interval / range / initialWindowMs / intraday flag', () => {
    expect(CANDLE_CONFIG['15m']).toEqual({
      interval: '15m',
      range: '59d',
      initialWindowMs: 1 * DAY_MS,
      intraday: true,
      label: '15min',
    });
    expect(CANDLE_CONFIG['30m']).toEqual({
      interval: '30m',
      range: '59d',
      initialWindowMs: 2 * DAY_MS,
      intraday: true,
      label: '30min',
    });
    expect(CANDLE_CONFIG['1h']).toEqual({
      interval: '1h',
      range: '700d',
      initialWindowMs: 3 * DAY_MS,
      intraday: true,
      label: '1h',
    });
    expect(CANDLE_CONFIG['1d']).toEqual({
      interval: '1d',
      range: '10y',
      initialWindowMs: 90 * DAY_MS,
      intraday: false,
      label: '1D',
    });
    expect(CANDLE_CONFIG['1wk']).toEqual({
      interval: '1wk',
      range: '50y',
      initialWindowMs: 365 * DAY_MS,
      intraday: false,
      label: '1W',
    });
    expect(CANDLE_CONFIG['1mo']).toEqual({
      interval: '1mo',
      range: '50y',
      initialWindowMs: 5 * 365 * DAY_MS,
      intraday: false,
      label: '1M',
    });
  });

  it('partitions candles into intraday and period groups', () => {
    expect(INTRADAY_CANDLES).toEqual(['15m', '30m', '1h']);
    expect(PERIOD_CANDLES).toEqual(['1d', '1wk', '1mo']);
    for (const c of INTRADAY_CANDLES) expect(CANDLE_CONFIG[c].intraday).toBe(true);
    for (const c of PERIOD_CANDLES) expect(CANDLE_CONFIG[c].intraday).toBe(false);
  });
});
