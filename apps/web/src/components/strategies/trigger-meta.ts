/**
 * Shared metadata for strategy triggers: label maps used by both the editor
 * (trigger-param-fields.tsx) and the read-only detail view, plus parsers and
 * a humanizer that turns raw `{ type, params }` into a one-line sentence.
 */

export const TRIGGER_TYPE_LABELS: Record<string, string> = {
  PRICE_MOVE: 'Price Move',
  INDICATOR_THRESHOLD: 'Indicator',
  CONCENTRATION_DRIFT: 'Concentration Drift',
  ALLOCATION_DRIFT: 'Allocation Drift',
  DRAWDOWN: 'Drawdown',
  EARNINGS_PROXIMITY: 'Earnings Proximity',
  METRIC_THRESHOLD: 'Metric',
  SIGNAL_PRESENT: 'Signal',
  PERSON_ACTIVITY: 'Person Activity',
  CUSTOM: 'Custom (LLM)',
};

export const INDICATOR_LABELS: Record<string, string> = {
  RSI: 'RSI (14)',
  MFI: 'MFI (14)',
  WILLIAMS_R: 'Williams %R',
  STOCH_K: 'Stochastic %K',
  STOCH_D: 'Stochastic %D',
  MACD: 'MACD Histogram',
  MACD_LINE: 'MACD Line',
  MACD_SIGNAL: 'MACD Signal',
  EMA: 'EMA (10)',
  EMA_50: 'EMA (50)',
  EMA_200: 'EMA (200)',
  SMA_20: 'SMA (20)',
  SMA: 'SMA (50)',
  SMA_200: 'SMA (200)',
  WMA_52: '52-WMA',
  VWMA: 'VWMA (20)',
  VWAP: 'VWAP',
  BB_UPPER: 'Bollinger Upper',
  BB_MIDDLE: 'Bollinger Middle',
  BB_LOWER: 'Bollinger Lower',
  BB_WIDTH: 'Bollinger Band Width',
  ATR: 'ATR (14)',
  ADX: 'ADX',
  PSAR: 'Parabolic SAR',
  OBV: 'OBV',
  GOLDEN_CROSS: 'Golden Cross',
  DEATH_CROSS: 'Death Cross',
  EMA_CROSS: 'EMA Cross',
};

export const METRIC_LABELS: Record<string, string> = {
  priceToBook: 'Price-to-Book',
  roe: 'ROE',
  sue: 'SUE',
  sentiment_momentum_24h: 'Sentiment Momentum 24h',
};

export const SIGNAL_TYPE_LABELS: Record<string, string> = {
  NEWS: 'News',
  FUNDAMENTAL: 'Fundamental',
  SENTIMENT: 'Sentiment',
  TECHNICAL: 'Technical',
  MACRO: 'Macro',
  FILINGS: 'Filings',
  SOCIALS: 'Socials',
};

const DIRECTION_VERBS: Record<string, string> = {
  above: 'above',
  below: 'below',
  crosses_above: 'crosses above',
  crosses_below: 'crosses below',
  drop: 'drops',
  rise: 'rises',
};

export function parseParams(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parseTargetWeights(raw: string | null | undefined): { ticker: string; weight: number }[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
      .map(([ticker, weight]) => ({ ticker, weight: weight as number }));
  } catch {
    return [];
  }
}

function fmtPercent(value: number, fractionDigits = 1): string {
  const rounded = Number(value.toFixed(fractionDigits));
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(fractionDigits)}%`;
}

function num(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function humanizeWithParams(type: string, params: Record<string, unknown>): string | null {
  switch (type) {
    case 'PRICE_MOVE': {
      const direction = str(params, 'direction') ?? 'drop';
      const verb = DIRECTION_VERBS[direction] ?? direction;
      const threshold = num(params, 'threshold');
      const lookback = num(params, 'lookback_months');
      const pct = threshold !== undefined ? fmtPercent(threshold * 100) : '?';
      const window = lookback !== undefined ? ` over ${lookback} month${lookback === 1 ? '' : 's'}` : '';
      return `Price ${verb} ≥${pct}${window}`;
    }
    case 'INDICATOR_THRESHOLD': {
      const indicator = str(params, 'indicator');
      const direction = str(params, 'direction') ?? 'above';
      const threshold = num(params, 'threshold');
      if (!indicator || threshold === undefined) return null;
      const label = INDICATOR_LABELS[indicator] ?? indicator;
      return `${label} ${DIRECTION_VERBS[direction] ?? direction} ${threshold}`;
    }
    case 'DRAWDOWN': {
      const threshold = num(params, 'threshold');
      if (threshold === undefined) return null;
      return `Drawdown ≥${fmtPercent(Math.abs(threshold) * 100)}`;
    }
    case 'EARNINGS_PROXIMITY': {
      const within = num(params, 'withinDays');
      if (within === undefined) return null;
      return `Earnings within ${within} day${within === 1 ? '' : 's'}`;
    }
    case 'METRIC_THRESHOLD': {
      const metric = str(params, 'metric');
      const direction = str(params, 'direction') ?? 'above';
      const threshold = num(params, 'threshold');
      if (!metric || threshold === undefined) return null;
      const label = METRIC_LABELS[metric] ?? metric;
      return `${label} ${DIRECTION_VERBS[direction] ?? direction} ${threshold}`;
    }
    case 'CONCENTRATION_DRIFT': {
      const max = num(params, 'maxWeight');
      if (max === undefined) return null;
      return `Position weight above ${fmtPercent(max * 100)}`;
    }
    case 'ALLOCATION_DRIFT': {
      const drift = num(params, 'driftThreshold');
      const tolBps = num(params, 'toleranceBps');
      const direction = str(params, 'direction') ?? 'both';
      const driftStr = drift !== undefined ? fmtPercent(drift * 100) : '?';
      const dirStr = direction === 'both' ? '' : ` (${direction})`;
      const tolStr = tolBps !== undefined ? `, per-ticker tolerance ${fmtPercent(tolBps / 100)}` : '';
      return `Allocation drift ≥${driftStr}${dirStr}${tolStr}`;
    }
    case 'SIGNAL_PRESENT': {
      const types = Array.isArray(params.signal_types) ? (params.signal_types as unknown[]) : [];
      const labels = types.filter((t): t is string => typeof t === 'string').map((t) => SIGNAL_TYPE_LABELS[t] ?? t);
      const lookback = num(params, 'lookback_hours');
      const minSent = num(params, 'min_sentiment');
      const typeStr = labels.length > 0 ? labels.join(', ') : 'Any';
      const window = lookback !== undefined ? ` within ${lookback}h` : '';
      const sentStr = minSent !== undefined && minSent > 0 ? ` (min sentiment ${minSent.toFixed(2)})` : '';
      return `${typeStr} signal${window}${sentStr}`;
    }
    case 'PERSON_ACTIVITY': {
      const person = str(params, 'person');
      const action = str(params, 'action') ?? 'ANY';
      const minDollar = num(params, 'minDollar');
      const lookback = num(params, 'lookback_days');
      if (!person) return null;
      const verb = action === 'BUY' ? 'buys' : action === 'SELL' ? 'sells' : 'trades';
      const dollars = minDollar !== undefined ? ` ≥$${minDollar.toLocaleString()}` : '';
      const window = lookback !== undefined ? ` in ${lookback} day${lookback === 1 ? '' : 's'}` : '';
      return `${person} ${verb}${dollars}${window}`;
    }
    case 'CUSTOM':
    default:
      return null;
  }
}

/**
 * Render a one-line sentence for a trigger. Falls back to the user-authored
 * description when params are missing or the type is CUSTOM.
 */
export function humanizeTrigger(
  type: string,
  rawParams: string | null | undefined,
  fallbackDescription: string,
): string {
  const params = parseParams(rawParams);
  return humanizeWithParams(type, params) ?? fallbackDescription;
}
