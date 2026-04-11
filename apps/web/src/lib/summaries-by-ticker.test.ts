import { describe, it, expect } from 'vitest';

import type { Summary } from '../api/types';

import { groupSummariesByTicker } from './summaries-by-ticker';

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    id: overrides.id ?? `s-${Math.random().toString(36).slice(2, 10)}`,
    ticker: overrides.ticker ?? 'AAPL',
    what: overrides.what ?? 'Truist cuts AAPL PT to $323',
    flow: overrides.flow ?? 'MICRO',
    severity: overrides.severity ?? 0.5,
    severityLabel: overrides.severityLabel ?? 'MEDIUM',
    sourceSignalIds: overrides.sourceSignalIds ?? [],
    contentHash: overrides.contentHash ?? 'deadbeef',
    createdAt: overrides.createdAt ?? '2026-04-11T12:00:00.000Z',
  };
}

describe('groupSummariesByTicker', () => {
  it('groups summaries into ticker-keyed buckets', () => {
    const result = groupSummariesByTicker([
      makeSummary({ id: 's-1', ticker: 'AAPL' }),
      makeSummary({ id: 's-2', ticker: 'NVDA' }),
      makeSummary({ id: 's-3', ticker: 'AAPL' }),
    ]);

    expect(result.size).toBe(2);
    expect(result.get('AAPL')?.map((s) => s.id)).toEqual(['s-1', 's-3']);
    expect(result.get('NVDA')?.map((s) => s.id)).toEqual(['s-2']);
  });

  it('sorts each bucket by severity DESC, then createdAt DESC', () => {
    const result = groupSummariesByTicker([
      makeSummary({ id: 'low', ticker: 'AAPL', severity: 0.2, createdAt: '2026-04-11T10:00:00.000Z' }),
      makeSummary({ id: 'high-old', ticker: 'AAPL', severity: 0.9, createdAt: '2026-04-10T10:00:00.000Z' }),
      makeSummary({ id: 'high-new', ticker: 'AAPL', severity: 0.9, createdAt: '2026-04-11T12:00:00.000Z' }),
    ]);

    expect(result.get('AAPL')?.map((s) => s.id)).toEqual(['high-new', 'high-old', 'low']);
  });

  it('drops the PORTFOLIO sentinel bucket so it never leaks into display data', () => {
    // The macro insight pipeline files portfolio-level risks/opportunities
    // under ticker='PORTFOLIO' (see src/scheduler.ts persistMacroSummaries).
    // The mapping layer must strip them — otherwise the snap card would
    // render a clickable "PORTFOLIO" label as if it were a real ticker.
    const result = groupSummariesByTicker([
      makeSummary({ id: 's-real', ticker: 'ICVT' }),
      makeSummary({ id: 's-pf', ticker: 'PORTFOLIO', what: 'Cross-cutting concentration risk' }),
    ]);

    expect(result.has('PORTFOLIO')).toBe(false);
    expect(result.size).toBe(1);
    expect(result.get('ICVT')?.map((s) => s.id)).toEqual(['s-real']);
  });

  it('returns an empty map for an empty input', () => {
    expect(groupSummariesByTicker([]).size).toBe(0);
  });
});
