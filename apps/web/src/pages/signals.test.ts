import { describe, it, expect } from 'vitest';
import { collectInsightSignalIds } from '../lib/insight-signals';

describe('collectInsightSignalIds', () => {
  it('returns empty set when report is null', () => {
    expect(collectInsightSignalIds(null).size).toBe(0);
  });

  it('returns empty set when report is undefined', () => {
    expect(collectInsightSignalIds(undefined).size).toBe(0);
  });

  it('collects position-level keySignal IDs', () => {
    const report = {
      positions: [
        { keySignals: [{ signalId: 'sig-1' }, { signalId: 'sig-2' }] },
        { keySignals: [{ signalId: 'sig-3' }] },
      ],
      portfolio: { topRisks: [], topOpportunities: [], actionItems: [] },
    };
    const ids = collectInsightSignalIds(report);
    expect(ids).toEqual(new Set(['sig-1', 'sig-2', 'sig-3']));
  });

  it('collects portfolio-level topRisks signalIds', () => {
    const report = {
      positions: [],
      portfolio: {
        topRisks: [{ signalIds: ['risk-sig-1', 'risk-sig-2'] }],
        topOpportunities: [],
        actionItems: [],
      },
    };
    const ids = collectInsightSignalIds(report);
    expect(ids).toEqual(new Set(['risk-sig-1', 'risk-sig-2']));
  });

  it('collects portfolio-level topOpportunities signalIds', () => {
    const report = {
      positions: [],
      portfolio: {
        topRisks: [],
        topOpportunities: [{ signalIds: ['opp-sig-1'] }, { signalIds: ['opp-sig-2'] }],
        actionItems: [],
      },
    };
    const ids = collectInsightSignalIds(report);
    expect(ids).toEqual(new Set(['opp-sig-1', 'opp-sig-2']));
  });

  it('collects portfolio-level actionItems signalIds', () => {
    const report = {
      positions: [],
      portfolio: {
        topRisks: [],
        topOpportunities: [],
        actionItems: [{ signalIds: ['action-sig-1', 'action-sig-2'] }],
      },
    };
    const ids = collectInsightSignalIds(report);
    expect(ids).toEqual(new Set(['action-sig-1', 'action-sig-2']));
  });

  it('combines all sources and deduplicates', () => {
    const report = {
      positions: [{ keySignals: [{ signalId: 'shared-1' }, { signalId: 'pos-only' }] }],
      portfolio: {
        topRisks: [{ signalIds: ['shared-1', 'risk-only'] }],
        topOpportunities: [{ signalIds: ['shared-1', 'opp-only'] }],
        actionItems: [{ signalIds: ['action-only'] }],
      },
    };
    const ids = collectInsightSignalIds(report);
    expect(ids).toEqual(new Set(['shared-1', 'pos-only', 'risk-only', 'opp-only', 'action-only']));
    // shared-1 appears 3 times but set has it once
    expect(ids.size).toBe(5);
  });

  it('handles empty positions and empty portfolio items', () => {
    const report = {
      positions: [{ keySignals: [] }],
      portfolio: {
        topRisks: [{ signalIds: [] }],
        topOpportunities: [],
        actionItems: [{ signalIds: [] }],
      },
    };
    const ids = collectInsightSignalIds(report);
    expect(ids.size).toBe(0);
  });
});
