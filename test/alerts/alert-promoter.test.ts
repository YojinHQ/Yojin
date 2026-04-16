import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ALERT_PROMOTER_CONFIG,
  buildAlert,
  meetsThreshold,
  resolveSeverity,
} from '../../src/alerts/alert-promoter.js';
import { severityToLabel } from '../../src/alerts/types.js';
import type { MicroInsight } from '../../src/insights/micro-types.js';

function makeMicroInsight(overrides: Partial<MicroInsight> = {}): MicroInsight {
  return {
    id: 'micro-test-123',
    symbol: 'AAPL',
    name: 'Apple Inc.',
    source: 'portfolio',
    rating: 'VERY_BULLISH',
    conviction: 0.9,
    severity: 0.85,
    thesis: 'Major earnings surprise driving significant upside potential',
    keyDevelopments: ['Revenue beat by 15%', 'New product announced'],
    risks: ['Valuation stretched'],
    opportunities: ['AI revenue accelerating'],
    sentiment: 'BULLISH',
    signalCount: 5,
    topSignalIds: ['sig-1', 'sig-2'],
    assetSnap: 'AAPL showing strong momentum after earnings',
    assetActions: ['Consider increasing position on earnings strength'],
    generatedAt: new Date().toISOString(),
    durationMs: 1500,
    ...overrides,
  };
}

describe('severityToLabel', () => {
  it('returns CRITICAL for severity >= 0.9', () => {
    expect(severityToLabel(0.9)).toBe('CRITICAL');
    expect(severityToLabel(1.0)).toBe('CRITICAL');
  });

  it('returns HIGH for severity >= 0.7 and < 0.9', () => {
    expect(severityToLabel(0.7)).toBe('HIGH');
    expect(severityToLabel(0.89)).toBe('HIGH');
  });

  it('returns MEDIUM for severity < 0.7', () => {
    expect(severityToLabel(0.69)).toBe('MEDIUM');
    expect(severityToLabel(0.0)).toBe('MEDIUM');
  });
});

describe('resolveSeverity', () => {
  it('uses the LLM-emitted severity when present', () => {
    const insight = makeMicroInsight({ severity: 0.92 });
    expect(resolveSeverity(insight)).toBe(0.92);
  });

  it('falls back to conviction * rating multiplier when severity is undefined', () => {
    const insight = makeMicroInsight({ severity: undefined, conviction: 0.8, rating: 'VERY_BULLISH' });
    // VERY_BULLISH multiplier = 1.0, so 0.8 * 1.0 = 0.8
    expect(resolveSeverity(insight)).toBe(0.8);
  });

  it('uses NEUTRAL multiplier for neutral ratings', () => {
    const insight = makeMicroInsight({ severity: undefined, conviction: 0.9, rating: 'NEUTRAL' });
    // NEUTRAL multiplier = 0.4, so 0.9 * 0.4 = 0.36
    expect(resolveSeverity(insight)).toBeCloseTo(0.36);
  });
});

describe('meetsThreshold', () => {
  it('returns true when severity meets the threshold', () => {
    const insight = makeMicroInsight({ severity: 0.85 });
    expect(meetsThreshold(insight, 0.7)).toBe(true);
  });

  it('returns false when severity is below the threshold', () => {
    const insight = makeMicroInsight({ severity: 0.5 });
    expect(meetsThreshold(insight, 0.7)).toBe(false);
  });

  it('returns true at exactly the threshold', () => {
    const insight = makeMicroInsight({ severity: 0.7 });
    expect(meetsThreshold(insight, 0.7)).toBe(true);
  });

  it('uses the default threshold of 0.7', () => {
    expect(DEFAULT_ALERT_PROMOTER_CONFIG.severityThreshold).toBe(0.7);
  });
});

describe('buildAlert', () => {
  it('builds an alert from a MicroInsight', () => {
    const insight = makeMicroInsight({ severity: 0.92 });
    const alert = buildAlert(insight);

    expect(alert.id).toMatch(/^alert-/);
    expect(alert.insightId).toBe('micro-test-123');
    expect(alert.symbol).toBe('AAPL');
    expect(alert.severity).toBe(0.92);
    expect(alert.severityLabel).toBe('CRITICAL');
    expect(alert.thesis).toBe('Major earnings surprise driving significant upside potential');
    expect(alert.keyDevelopments).toEqual(['Revenue beat by 15%', 'New product announced']);
    expect(alert.rating).toBe('VERY_BULLISH');
    expect(alert.sentiment).toBe('BULLISH');
    expect(alert.status).toBe('ACTIVE');
    expect(alert.createdAt).toBeDefined();
  });

  it('assigns correct severity labels', () => {
    const critical = buildAlert(makeMicroInsight({ severity: 0.95 }));
    expect(critical.severityLabel).toBe('CRITICAL');

    const high = buildAlert(makeMicroInsight({ severity: 0.75 }));
    expect(high.severityLabel).toBe('HIGH');
  });
});
