import { describe, expect, it } from 'vitest';

import { parseVerdictFromHeadline } from '../../src/actions/types.js';
import {
  formatAllocationBudget,
  formatBuySizeGuidance,
  parseActionResponse,
} from '../../src/strategies/action-reasoning.js';
import type { StrategyEvaluation } from '../../src/strategies/types.js';

function makeEvaluation(partial: Partial<StrategyEvaluation> = {}): StrategyEvaluation {
  return {
    strategyId: 'strat-1',
    strategyName: 'Test strategy',
    triggerId: 'strat-1-THRESHOLD-AAPL',
    triggerType: 'ALLOCATION_DRIFT',
    triggerDescription: 'AAPL below target allocation',
    context: { ticker: 'AAPL' },
    strategyContent: '# Test',
    evaluatedAt: new Date().toISOString(),
    triggerStrength: 'MODERATE',
    ...partial,
  } as StrategyEvaluation;
}

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

describe('parseActionResponse', () => {
  const evaluation = makeEvaluation();

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
    expect(result.headline).toBe('REVIEW AAPL — AAPL below target allocation');
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
