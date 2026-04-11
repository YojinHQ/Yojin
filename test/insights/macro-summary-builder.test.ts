/**
 * buildMacroSummaryInputs — placement contract tests.
 *
 * Locks in the architectural rule that ticker-specific observations from a
 * PositionInsight (thesis, risks, opportunities) get filed under the real
 * ticker, while portfolio-level items live under the PORTFOLIO sentinel.
 * This is the test that catches regressions where ICVT-specific content
 * would otherwise be mislabeled as portfolio-wide and leak into the display
 * layer's sentinel bucket.
 */

import { describe, expect, it } from 'vitest';

import { buildMacroSummaryInputs, firstSentence } from '../../src/insights/macro-summary-builder.js';
import type { InsightReport, PositionInsight } from '../../src/insights/types.js';
import { PORTFOLIO_TICKER } from '../../src/summaries/types.js';

function makePosition(symbol: string, overrides: Partial<PositionInsight> = {}): PositionInsight {
  return {
    symbol,
    name: symbol,
    rating: 'NEUTRAL',
    conviction: 0.7,
    thesis: `${symbol} thesis headline. Supporting context paragraph with more detail.`,
    keySignals: [],
    allSignalIds: [],
    risks: [],
    opportunities: [],
    memoryContext: null,
    priceTarget: null,
    ...overrides,
  };
}

function makeReport(positions: PositionInsight[], overrides: Partial<InsightReport> = {}): InsightReport {
  return {
    id: 'report-1',
    snapshotId: 'snap-1',
    positions,
    portfolio: {
      overallHealth: 'HEALTHY',
      summary: 'Test summary',
      intelSummary: '',
      sectorThemes: [],
      macroContext: '',
      topRisks: [],
      topOpportunities: [],
      actionItems: [],
    },
    agentOutputs: { researchAnalyst: '', riskManager: '', strategist: '' },
    emotionState: { confidence: 0.7, riskAppetite: 0.5, reason: '' },
    createdAt: '2026-04-11T12:00:00.000Z',
    durationMs: 1000,
    ...overrides,
  };
}

describe('firstSentence', () => {
  it('returns the first sentence of a multi-sentence thesis', () => {
    expect(firstSentence('AAPL beats earnings. Guidance raised. Stock up.')).toBe('AAPL beats earnings.');
  });

  it('returns the full text when there is no sentence terminator', () => {
    expect(firstSentence('AAPL beats earnings')).toBe('AAPL beats earnings');
  });

  it('truncates with an ellipsis when longer than maxLen', () => {
    const long = 'x'.repeat(300);
    const result = firstSentence(long, 240);
    expect(result.length).toBe(240);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns empty string for whitespace-only input', () => {
    expect(firstSentence('   \n  ')).toBe('');
  });
});

describe('buildMacroSummaryInputs — per-position placement', () => {
  it('files the position thesis under the real ticker with severity=conviction', () => {
    const report = makeReport([
      makePosition('aapl', { conviction: 0.85, thesis: 'AAPL supply chain risk. Guidance unclear.' }),
    ]);

    const inputs = buildMacroSummaryInputs(report);

    expect(inputs).toHaveLength(1);
    const [thesis] = inputs;
    expect(thesis.ticker).toBe('AAPL');
    expect(thesis.what).toBe('AAPL supply chain risk.');
    expect(thesis.flow).toBe('MACRO');
    expect(thesis.severity).toBe(0.85);
  });

  it('files per-position risks under the real ticker, NOT under PORTFOLIO', () => {
    const report = makeReport([
      makePosition('ICVT', {
        thesis: 'ICVT thesis.',
        risks: ['ICVT gap-up catalyst unconfirmed', 'MFI at 97th percentile with no fundamental backing'],
      }),
    ]);

    const inputs = buildMacroSummaryInputs(report);
    const icvt = inputs.filter((i) => i.ticker === 'ICVT');
    const portfolio = inputs.filter((i) => i.ticker === PORTFOLIO_TICKER);

    expect(portfolio).toHaveLength(0);
    expect(icvt).toHaveLength(3); // thesis + 2 risks
    const risks = icvt.filter((i) => i.what !== 'ICVT thesis.');
    expect(risks.map((r) => r.what)).toEqual([
      'ICVT gap-up catalyst unconfirmed',
      'MFI at 97th percentile with no fundamental backing',
    ]);
  });

  it('leaves risks/opportunities with severity undefined so the thesis sorts above them', () => {
    const report = makeReport([
      makePosition('NVDA', {
        conviction: 0.8,
        thesis: 'NVDA datacenter demand surge.',
        risks: ['China export controls'],
        opportunities: ['Enterprise AI uptake'],
      }),
    ]);

    const inputs = buildMacroSummaryInputs(report);
    const [thesis, risk, opp] = inputs;

    expect(thesis.severity).toBe(0.8);
    expect(risk.severity).toBeUndefined();
    expect(opp.severity).toBeUndefined();
  });

  it('skips whitespace-only risks and opportunities', () => {
    const report = makeReport([
      makePosition('AAPL', {
        thesis: 'AAPL thesis.',
        risks: ['   ', 'Real risk'],
        opportunities: ['', '  '],
      }),
    ]);

    const inputs = buildMacroSummaryInputs(report);
    const byText = inputs.map((i) => i.what);
    expect(byText).toContain('Real risk');
    expect(byText.every((t) => t.trim().length > 0)).toBe(true);
  });

  it('skips positions with a blank thesis but still emits their risks/opportunities', () => {
    const report = makeReport([
      makePosition('AAPL', { thesis: '   ', risks: ['Supply chain'], opportunities: ['iPhone cycle'] }),
    ]);

    const inputs = buildMacroSummaryInputs(report);
    expect(inputs).toHaveLength(2);
    expect(inputs.map((i) => i.what).sort()).toEqual(['Supply chain', 'iPhone cycle'].sort());
  });

  it('deduplicates sourceSignalIds between keySignals and allSignalIds', () => {
    const position = makePosition('AAPL', {
      keySignals: [
        {
          signalId: 'sig-1',
          type: 'NEWS',
          title: 't',
          impact: 'POSITIVE',
          confidence: 0.8,
          url: null,
          sourceCount: 1,
          detail: null,
          outputType: 'INSIGHT',
        },
      ],
      allSignalIds: ['sig-1', 'sig-2'],
    });
    const inputs = buildMacroSummaryInputs(makeReport([position]));
    expect(inputs[0].sourceSignalIds.sort()).toEqual(['sig-1', 'sig-2']);
  });
});

describe('buildMacroSummaryInputs — portfolio-level placement', () => {
  it('files portfolio topRisks/topOpportunities/actionItems under the PORTFOLIO sentinel', () => {
    const report = makeReport([], {
      portfolio: {
        overallHealth: 'HEALTHY',
        summary: 's',
        intelSummary: '',
        sectorThemes: [],
        macroContext: '',
        topRisks: [{ text: '3 of 5 crypto holdings exposed to ETF-outflow pressure', signalIds: ['sig-a'] }],
        topOpportunities: [{ text: 'Sector rotation favouring industrials', signalIds: [] }],
        actionItems: [{ text: 'Concentration in top 2 positions > 60%', signalIds: [] }],
      },
    });

    const inputs = buildMacroSummaryInputs(report);

    expect(inputs).toHaveLength(3);
    expect(inputs.every((i) => i.ticker === PORTFOLIO_TICKER)).toBe(true);
    expect(inputs.every((i) => i.flow === 'MACRO')).toBe(true);
    expect(inputs[0].sourceSignalIds).toEqual(['sig-a']);
    // Portfolio-level items have no severity — they rank at the bottom of
    // the feed unless the consumer chooses to promote them.
    expect(inputs.every((i) => i.severity === undefined)).toBe(true);
  });

  it('produces stable contentHash values for dedup', () => {
    const report = makeReport([], {
      portfolio: {
        overallHealth: 'HEALTHY',
        summary: 's',
        intelSummary: '',
        sectorThemes: [],
        macroContext: '',
        topRisks: [{ text: 'Concentration risk', signalIds: [] }],
        topOpportunities: [],
        actionItems: [],
      },
    });

    const a = buildMacroSummaryInputs(report);
    const b = buildMacroSummaryInputs(report);
    expect(a[0].contentHash).toBe(b[0].contentHash);
    expect(a[0].contentHash.length).toBeGreaterThan(0);
  });

  it('skips whitespace-only portfolio items', () => {
    const report = makeReport([], {
      portfolio: {
        overallHealth: 'HEALTHY',
        summary: 's',
        intelSummary: '',
        sectorThemes: [],
        macroContext: '',
        topRisks: [{ text: '   ', signalIds: [] }],
        topOpportunities: [{ text: '', signalIds: [] }],
        actionItems: [{ text: 'Real portfolio item', signalIds: [] }],
      },
    });

    const inputs = buildMacroSummaryInputs(report);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].what).toBe('Real portfolio item');
  });
});

describe('buildMacroSummaryInputs — mixed report (regression guard)', () => {
  it('does not leak single-ticker content into the PORTFOLIO bucket', () => {
    // Guard against the specific bug: even if the LLM wrongly put
    // "ICVT..." into portfolio.topRisks, the builder must file whatever
    // was actually placed where it was placed. We test the correct case
    // below; the display layer provides the backstop for misplacement.
    const report = makeReport(
      [
        makePosition('ICVT', {
          thesis: 'ICVT thesis headline.',
          risks: ['ICVT gap-up catalyst unconfirmed'],
        }),
      ],
      {
        portfolio: {
          overallHealth: 'HEALTHY',
          summary: 's',
          intelSummary: '',
          sectorThemes: [],
          macroContext: '',
          topRisks: [{ text: 'Concentration in top 2 holdings exceeds 60%', signalIds: [] }],
          topOpportunities: [],
          actionItems: [],
        },
      },
    );

    const inputs = buildMacroSummaryInputs(report);
    const icvtInputs = inputs.filter((i) => i.ticker === 'ICVT');
    const portfolioInputs = inputs.filter((i) => i.ticker === PORTFOLIO_TICKER);

    expect(icvtInputs).toHaveLength(2);
    expect(portfolioInputs).toHaveLength(1);
    expect(portfolioInputs[0].what).toBe('Concentration in top 2 holdings exceeds 60%');
    // Sanity: no ICVT content is filed under PORTFOLIO
    expect(portfolioInputs.every((i) => !i.what.includes('ICVT'))).toBe(true);
  });
});
