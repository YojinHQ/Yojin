const DAY_MS = 24 * 60 * 60 * 1000;

export type Candle = '15m' | '30m' | '1h' | '1d' | '1wk' | '1mo';

export interface CandleConfig {
  /** Interval string passed to the backend (matches Yahoo codes). */
  interval: string;
  /**
   * Equity range passed to the backend. Over-fetches so pan is instant.
   * Chosen from the set Jintel actually accepts — notably Yahoo-named
   * ranges like `max` / `3mo` silently return empty for intraday intervals,
   * so we use numeric `Nd` / `Ny` forms instead.
   */
  range: string;
  /**
   * Crypto range. Jintel returns crypto history at a fixed granularity per
   * named range regardless of `interval`, and only accepts named ranges
   * (Nd/Ny fail). We pick the named range whose native granularity best
   * matches this candle size.
   */
  cryptoRange: string;
  /** Initial visible window width in milliseconds. */
  initialWindowMs: number;
  /** True for sub-day candles (15m/30m/1h). */
  intraday: boolean;
  /** User-facing label for selector UI. */
  label: string;
}

export const CANDLE_CONFIG: Record<Candle, CandleConfig> = {
  '15m': {
    interval: '15m',
    range: '59d',
    cryptoRange: '1d',
    initialWindowMs: 1 * DAY_MS,
    intraday: true,
    label: '15min',
  },
  '30m': {
    interval: '30m',
    range: '59d',
    cryptoRange: '1d',
    initialWindowMs: 2 * DAY_MS,
    intraday: true,
    label: '30min',
  },
  '1h': { interval: '1h', range: '700d', cryptoRange: '5d', initialWindowMs: 3 * DAY_MS, intraday: true, label: '1h' },
  '1d': {
    interval: '1d',
    range: '10y',
    cryptoRange: '1mo',
    initialWindowMs: 90 * DAY_MS,
    intraday: false,
    label: '1D',
  },
  '1wk': {
    interval: '1wk',
    range: '50y',
    cryptoRange: 'max',
    initialWindowMs: 365 * DAY_MS,
    intraday: false,
    label: '1W',
  },
  '1mo': {
    interval: '1mo',
    range: '50y',
    cryptoRange: 'max',
    initialWindowMs: 5 * 365 * DAY_MS,
    intraday: false,
    label: '1M',
  },
};

export const INTRADAY_CANDLES: Candle[] = ['15m', '30m', '1h'];
export const PERIOD_CANDLES: Candle[] = ['1d', '1wk', '1mo'];
