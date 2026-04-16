/**
 * Alert promoter — pure functions that decide whether a MicroInsight should
 * be promoted to an Alert and build the Alert record.
 *
 * Promotion criteria:
 * 1. Severity >= configurable threshold (default 0.7 = HIGH tier)
 * 2. Not already alerted for this insightId
 * 3. No recent alert for the same ticker within cooldown window (unless severity escalates)
 */

import { randomUUID } from 'node:crypto';

import type { Alert } from './types.js';
import { severityToLabel } from './types.js';
import type { MicroInsight } from '../insights/micro-types.js';
import { computeMicroSummarySeverity } from '../summaries/micro-severity.js';

export interface AlertPromoterConfig {
  /** Minimum severity to trigger an alert. Default: 0.7 (HIGH tier). */
  severityThreshold: number;
  /** Cooldown per ticker in milliseconds. Default: 4 hours. */
  cooldownMs: number;
}

export const DEFAULT_ALERT_PROMOTER_CONFIG: AlertPromoterConfig = {
  severityThreshold: 0.7,
  cooldownMs: 4 * 60 * 60 * 1000, // 4 hours
};

/**
 * Resolve the effective severity of a MicroInsight, using the LLM-emitted
 * field with a back-compat fallback for older JSONL records.
 */
export function resolveSeverity(insight: MicroInsight): number {
  return computeMicroSummarySeverity({
    rating: insight.rating,
    conviction: insight.conviction,
    severity: insight.severity,
  });
}

/**
 * Check if a MicroInsight meets the severity threshold for promotion.
 */
export function meetsThreshold(insight: MicroInsight, threshold: number): boolean {
  return resolveSeverity(insight) >= threshold;
}

/**
 * Build an Alert from a MicroInsight. Does not check dedup or cooldown —
 * the caller is responsible for those checks.
 */
export function buildAlert(insight: MicroInsight): Alert {
  const severity = resolveSeverity(insight);

  return {
    id: `alert-${randomUUID()}`,
    insightId: insight.id,
    symbol: insight.symbol,
    severity,
    severityLabel: severityToLabel(severity),
    thesis: insight.thesis,
    keyDevelopments: insight.keyDevelopments,
    rating: insight.rating,
    sentiment: insight.sentiment,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
  };
}
