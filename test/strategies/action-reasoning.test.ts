import { describe, expect, it } from 'vitest';

import { parseVerdictFromHeadline } from '../../src/actions/types.js';
import {
  checkPricedIn,
  formatAllocationBudget,
  formatBuySizeGuidance,
  parseActionResponse,
  parseStructuredParams,
} from '../../src/strategies/action-reasoning.js';
import type { StrategyEvaluation } from '../../src/strategies/types.js';

function makeEvaluation(overrides?: Partial<StrategyEvaluation>): StrategyEvaluation {
  return {
    strategyId: 'strat-001',
    strategyName: 'Momentum Breakout',
    triggerId: 'strat-001-PRICE_MOVE-TSLA',
    triggerType: 'PRICE_MOVE',
    triggerDescription: 'Price moved +5.2%',
    context: { ticker: 'TSLA', change: 0.052, threshold: 0.05 },
    strategyContent: '# Momentum Breakout\nBuy on breakout...',
    evaluatedAt: new Date().toISOString(),
    triggerStrength: 'STRONG',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatBuySizeGuidance / formatAllocationBudget
// ---------------------------------------------------------------------------

describe('formatBuySizeGuidance', () => {
  it('renders target + actual when targetAllocation is present', () => {
    const text = formatBuySizeGuidance({ targetAllocation: 0.05, actualAllocation: 0.021 });
    expect(text).toBe('BUY to 5% of portfolio (now 2.1%)');
  });

  it('defaults actualAllocation to 0 when missing', () => {
    const text = formatBuySizeGuidance({ targetAllocation: 0.1 });
    expect(text).toBe('BUY to 10% of portfolio (now 0.0%)');
  });

  it('falls back to maxPositionSize as a soft cap when no target is set', () => {
    const text = formatBuySizeGuidance({ maxPositionSize: 0.02 });
    expect(text).toBe('BUY up to 2% of portfolio');
  });

  it('returns undefined when no allocation context is available', () => {
    expect(formatBuySizeGuidance({})).toBeUndefined();
    expect(formatBuySizeGuidance({ ticker: 'AAPL' })).toBeUndefined();
  });

  it('prefers targetAllocation over maxPositionSize when both are present', () => {
    const text = formatBuySizeGuidance({
      targetAllocation: 0.05,
      actualAllocation: 0.02,
      maxPositionSize: 0.1,
    });
    expect(text).toBe('BUY to 5% of portfolio (now 2.0%)');
  });
});

describe('formatAllocationBudget', () => {
  it('formats target/current/remaining when targetAllocation is set', () => {
    const text = formatAllocationBudget({ targetAllocation: 0.05, actualAllocation: 0.02 });
    expect(text).toContain('target 5% of portfolio');
    expect(text).toContain('current 2.0%');
    expect(text).toContain('remaining 3.0%');
  });

  it('returns empty string when no target is set', () => {
    expect(formatAllocationBudget({})).toBe('');
  });
});

// ---------------------------------------------------------------------------
// parseStructuredParams
// ---------------------------------------------------------------------------

describe('parseStructuredParams', () => {
  it('parses all structured params from well-formed lines', () => {
    const lines = [
      'ACTION: BUY TSLA — AI5 chip milestone confirmed',
      'ENTRY: $245-250',
      'TARGET: $275',
      'STOP: $230',
      'HORIZON: 1-2 weeks',
      'CONVICTION: HIGH',
      '',
      '## Why Now',
      'The AI5 chip partnership was confirmed...',
    ];
    const params = parseStructuredParams(lines);
    expect(params.entryRange).toBe('$245-250');
    expect(params.targetPrice).toBe(275);
    expect(params.stopLoss).toBe(230);
    expect(params.horizon).toBe('1-2 weeks');
    expect(params.conviction).toBe('HIGH');
  });

  it('handles "at market" entry range', () => {
    const params = parseStructuredParams(['ENTRY: at market']);
    expect(params.entryRange).toBe('at market');
  });

  it('handles prices with commas', () => {
    const params = parseStructuredParams(['TARGET: $1,250.50', 'STOP: $1,100']);
    expect(params.targetPrice).toBe(1250.5);
    expect(params.stopLoss).toBe(1100);
  });

  it('handles prices without dollar signs', () => {
    const params = parseStructuredParams(['TARGET: 260', 'STOP: 235']);
    expect(params.targetPrice).toBe(260);
    expect(params.stopLoss).toBe(235);
  });

  it('skips non-numeric target/stop values gracefully', () => {
    const params = parseStructuredParams(['TARGET: around $260', 'STOP: depends on volatility']);
    expect(params.targetPrice).toBeUndefined();
    expect(params.stopLoss).toBeUndefined();
  });

  it('normalizes conviction case', () => {
    const params = parseStructuredParams(['CONVICTION: medium']);
    expect(params.conviction).toBe('MEDIUM');
  });

  it('rejects invalid conviction values', () => {
    const params = parseStructuredParams(['CONVICTION: Moderate to High']);
    expect(params.conviction).toBeUndefined();
  });

  it('parses SUMMARY line', () => {
    const params = parseStructuredParams([
      'SUMMARY: Social sentiment surging ahead of earnings — act before the catalyst window closes.',
    ]);
    expect(params.summary).toBe('Social sentiment surging ahead of earnings — act before the catalyst window closes.');
  });

  it('returns empty object when no params are present', () => {
    const params = parseStructuredParams(['## Why Now', 'The stock broke out above resistance...']);
    expect(params).toEqual({});
  });

  it('parses partial params (only some lines present)', () => {
    const params = parseStructuredParams(['ENTRY: $245-250', 'CONVICTION: LOW']);
    expect(params.entryRange).toBe('$245-250');
    expect(params.conviction).toBe('LOW');
    expect(params.targetPrice).toBeUndefined();
    expect(params.stopLoss).toBeUndefined();
    expect(params.horizon).toBeUndefined();
  });

  it('handles zero or negative prices', () => {
    const params = parseStructuredParams(['TARGET: $0', 'STOP: $-10']);
    expect(params.targetPrice).toBeUndefined();
    expect(params.stopLoss).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseActionResponse
// ---------------------------------------------------------------------------

describe('parseActionResponse', () => {
  const evaluation = makeEvaluation();

  it('parses full structured response with headline + params + reasoning', () => {
    const rawOutput = [
      'ACTION: BUY TSLA — AI5 chip milestone confirmed',
      'ENTRY: $245-250',
      'TARGET: $275',
      'STOP: $230',
      'HORIZON: 1-2 weeks',
      'CONVICTION: HIGH',
      '',
      '## Why Now',
      'The AI5 chip partnership confirmed by Tesla today.',
      '',
      '## Key Risks',
      'RSI is already at 72, overbought territory.',
    ].join('\n');

    const result = parseActionResponse(rawOutput, evaluation);

    expect(result.headline).toBe('BUY TSLA — AI5 chip milestone confirmed');
    expect(result.entryRange).toBe('$245-250');
    expect(result.targetPrice).toBe(275);
    expect(result.stopLoss).toBe(230);
    expect(result.horizon).toBe('1-2 weeks');
    expect(result.conviction).toBe('HIGH');
    // Structured param lines should be filtered OUT of reasoning
    expect(result.reasoning).not.toContain('ENTRY:');
    expect(result.reasoning).not.toContain('TARGET:');
    expect(result.reasoning).not.toContain('CONVICTION:');
    expect(result.reasoning).toContain('AI5 chip partnership');
    expect(result.reasoning).toContain('RSI is already at 72');
  });

  it('parses ACTION-only response without SIZE', () => {
    const raw = 'ACTION: BUY AAPL — golden cross on 200-day MA\n\nAnalysis: momentum is strong.';
    const result = parseActionResponse(raw, evaluation);
    expect(result.parsedCleanly).toBe(true);
    expect(result.headline).toBe('BUY AAPL — golden cross on 200-day MA');
    expect(result.sizeGuidance).toBeUndefined();
    expect(result.reasoning).toContain('Analysis');
  });

  it('parses ACTION + SIZE for SELL', () => {
    const raw = 'ACTION: SELL TSLA — breakdown below support\nSIZE: SELL 50% of position\n\n1. Trend broken.';
    const result = parseActionResponse(raw, evaluation);
    expect(result.parsedCleanly).toBe(true);
    expect(result.headline).toBe('SELL TSLA — breakdown below support');
    expect(result.sizeGuidance).toBe('SELL 50% of position');
    expect(result.reasoning).toContain('Trend broken');
  });

  it('treats "N/A" SIZE as no sizing', () => {
    const raw = 'ACTION: REVIEW NVDA — conflicting signals\nSIZE: N/A\n\nNeeds manual review.';
    const result = parseActionResponse(raw, evaluation);
    expect(result.parsedCleanly).toBe(true);
    expect(result.sizeGuidance).toBeUndefined();
  });

  it('falls back to REVIEW when ACTION line is missing', () => {
    const raw = 'I think AAPL looks bullish but cannot commit.';
    const result = parseActionResponse(raw, evaluation);
    expect(result.parsedCleanly).toBe(false);
    expect(result.headline).toContain('REVIEW');
    expect(result.reasoning).toBe(raw);
  });

  it('marks SELL without a SIZE line as parsedCleanly=false', () => {
    const raw = 'ACTION: SELL TSLA — breakdown below support\n\nTrend broken.';
    const result = parseActionResponse(raw, evaluation);
    expect(result.parsedCleanly).toBe(false);
    expect(result.sizeGuidance).toBeUndefined();
    expect(result.headline).toBe('SELL TSLA — breakdown below support');
  });

  it('marks SELL with SIZE: N/A as parsedCleanly=false', () => {
    const raw = 'ACTION: SELL TSLA — breakdown below support\nSIZE: N/A\n\nTrend broken.';
    const result = parseActionResponse(raw, evaluation);
    expect(result.parsedCleanly).toBe(false);
    expect(result.sizeGuidance).toBeUndefined();
  });

  it('tolerates a short preamble before the ACTION line', () => {
    const raw = 'Based on the strategy rules:\nACTION: BUY AAPL — momentum intact\n\nAnalysis.';
    const result = parseActionResponse(raw, evaluation);
    expect(result.parsedCleanly).toBe(true);
    expect(result.headline).toBe('BUY AAPL — momentum intact');
    expect(result.reasoning).toContain('Analysis');
  });
});

describe('parseVerdictFromHeadline', () => {
  it('parses BUY/SELL/REVIEW at word boundary', () => {
    expect(parseVerdictFromHeadline('BUY AAPL — golden cross')).toBe('BUY');
    expect(parseVerdictFromHeadline('SELL TSLA — breakdown')).toBe('SELL');
    expect(parseVerdictFromHeadline('REVIEW NVDA — mixed signals')).toBe('REVIEW');
  });

  it('maps legacy TRIM to SELL', () => {
    expect(parseVerdictFromHeadline('TRIM AAPL — take profits')).toBe('SELL');
  });

  it('defaults unrecognized verbs to REVIEW (not BUY)', () => {
    expect(parseVerdictFromHeadline('HOLD AAPL — waiting')).toBe('REVIEW');
    expect(parseVerdictFromHeadline('WAIT AAPL — unclear')).toBe('REVIEW');
    expect(parseVerdictFromHeadline('gibberish')).toBe('REVIEW');
  });

  it('requires a word boundary — does not match BUYBACK as BUY', () => {
    expect(parseVerdictFromHeadline('BUYBACK announced')).toBe('REVIEW');
  });
});

// ---------------------------------------------------------------------------
// parseStructuredParams — MAX_ENTRY + CATALYST_IMPACT
// ---------------------------------------------------------------------------

describe('parseStructuredParams — priced-in fields', () => {
  it('parses MAX_ENTRY with dollar sign', () => {
    const params = parseStructuredParams(['MAX_ENTRY: $265']);
    expect(params.maxEntry).toBe(265);
  });

  it('parses MAX_ENTRY without dollar sign', () => {
    const params = parseStructuredParams(['MAX_ENTRY: 265.50']);
    expect(params.maxEntry).toBe(265.5);
  });

  it('parses MAX_ENTRY with commas', () => {
    const params = parseStructuredParams(['MAX_ENTRY: $1,265.00']);
    expect(params.maxEntry).toBe(1265);
  });

  it('skips non-numeric MAX_ENTRY', () => {
    const params = parseStructuredParams(['MAX_ENTRY: around $265']);
    expect(params.maxEntry).toBeUndefined();
  });

  it('skips zero/negative MAX_ENTRY', () => {
    const params = parseStructuredParams(['MAX_ENTRY: $0']);
    expect(params.maxEntry).toBeUndefined();
  });

  it('parses CATALYST_IMPACT', () => {
    const params = parseStructuredParams(['CATALYST_IMPACT: 3-5%']);
    expect(params.catalystImpact).toBe('3-5%');
  });

  it('parses CATALYST_IMPACT with descriptive text', () => {
    const params = parseStructuredParams(['CATALYST_IMPACT: ~8% upside from earnings beat']);
    expect(params.catalystImpact).toBe('~8% upside from earnings beat');
  });

  it('filters MAX_ENTRY and CATALYST_IMPACT from reasoning text', () => {
    const raw = [
      'ACTION: BUY AAPL — earnings beat',
      'MAX_ENTRY: $265',
      'CATALYST_IMPACT: 3-5%',
      '',
      'Strong quarter with revenue above expectations.',
    ].join('\n');
    const result = parseActionResponse(raw, makeEvaluation());
    expect(result.maxEntry).toBe(265);
    expect(result.catalystImpact).toBe('3-5%');
    expect(result.reasoning).not.toContain('MAX_ENTRY');
    expect(result.reasoning).not.toContain('CATALYST_IMPACT');
    expect(result.reasoning).toContain('Strong quarter');
  });

  it('parses full response with all params including new fields', () => {
    const raw = [
      'ACTION: BUY TSLA — AI5 confirmed',
      'SIZE: BUY to 5% of portfolio',
      'ENTRY: $245-250',
      'TARGET: $275',
      'STOP: $230',
      'HORIZON: 1-2 weeks',
      'CONVICTION: HIGH',
      'MAX_ENTRY: $260',
      'CATALYST_IMPACT: 5-8% upside',
      'SUMMARY: AI5 partnership confirmed — momentum window open before broader market catches up.',
      '',
      'The partnership has been confirmed.',
    ].join('\n');
    const result = parseActionResponse(raw, makeEvaluation());
    expect(result.parsedCleanly).toBe(true);
    expect(result.entryRange).toBe('$245-250');
    expect(result.targetPrice).toBe(275);
    expect(result.stopLoss).toBe(230);
    expect(result.horizon).toBe('1-2 weeks');
    expect(result.conviction).toBe('HIGH');
    expect(result.maxEntry).toBe(260);
    expect(result.catalystImpact).toBe('5-8% upside');
    expect(result.summary).toBe('AI5 partnership confirmed — momentum window open before broader market catches up.');
    expect(result.reasoning).not.toContain('SUMMARY:');
    expect(result.reasoning).toContain('partnership has been confirmed');
  });
});

// ---------------------------------------------------------------------------
// checkPricedIn
// ---------------------------------------------------------------------------

describe('checkPricedIn', () => {
  it('returns true when BUY price exceeds maxEntry', () => {
    expect(checkPricedIn('BUY', 270, 265)).toBe(true);
  });

  it('returns false when BUY price is below maxEntry', () => {
    expect(checkPricedIn('BUY', 260, 265)).toBe(false);
  });

  it('returns false when BUY price equals maxEntry', () => {
    expect(checkPricedIn('BUY', 265, 265)).toBe(false);
  });

  it('returns true when SELL price is below maxEntry (floor)', () => {
    expect(checkPricedIn('SELL', 50, 55)).toBe(true);
  });

  it('returns false when SELL price is above maxEntry (floor)', () => {
    expect(checkPricedIn('SELL', 60, 55)).toBe(false);
  });

  it('returns undefined when currentPrice is missing', () => {
    expect(checkPricedIn('BUY', undefined, 265)).toBeUndefined();
  });

  it('returns undefined when maxEntry is missing', () => {
    expect(checkPricedIn('BUY', 270, undefined)).toBeUndefined();
  });

  it('returns undefined for REVIEW verdict', () => {
    expect(checkPricedIn('REVIEW', 270, 265)).toBeUndefined();
  });
});
