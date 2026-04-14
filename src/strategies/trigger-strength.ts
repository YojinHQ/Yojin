/**
 * Trigger strength — deterministic scoring for strategy trigger conditions.
 *
 * Computes how far past their thresholds trigger conditions are, bucketed into
 * WEAK/MODERATE/STRONG/EXTREME. Used by the evaluator to score fired triggers
 * and by the UI to help users triage competing actions.
 */

import { z } from 'zod';

import type { TriggerType } from './types.js';

export const TriggerStrengthSchema = z.enum(['WEAK', 'MODERATE', 'STRONG', 'EXTREME']);
export type TriggerStrength = z.infer<typeof TriggerStrengthSchema>;

const STRENGTH_ORDER: Record<TriggerStrength, number> = {
  WEAK: 0,
  MODERATE: 1,
  STRONG: 2,
  EXTREME: 3,
};

/** Convert a normalized overshoot ratio to a strength label. */
export function ratioToStrength(ratio: number): TriggerStrength {
  if (!Number.isFinite(ratio) || ratio < 0.25) return 'WEAK';
  if (ratio < 0.75) return 'MODERATE';
  if (ratio <= 1.5) return 'STRONG';
  return 'EXTREME';
}

/**
 * Compute trigger strength from a fired condition's context data.
 * Each trigger type defines its own overshoot ratio formula.
 */
export function computeTriggerStrength(
  triggerType: TriggerType | string,
  context: Record<string, unknown>,
): TriggerStrength {
  switch (triggerType) {
    case 'PRICE_MOVE': {
      const change = Number(context['change'] ?? 0);
      const threshold = Number(context['threshold'] ?? 0);
      if (!Number.isFinite(change) || !Number.isFinite(threshold) || threshold === 0) return 'MODERATE';
      return ratioToStrength(Math.abs(change - threshold) / Math.abs(threshold));
    }

    case 'INDICATOR_THRESHOLD':
    case 'METRIC_THRESHOLD': {
      if (context['crossover']) return 'MODERATE';
      const value = Number(context['value'] ?? 0);
      const threshold = Number(context['threshold'] ?? 0);
      if (!Number.isFinite(value) || !Number.isFinite(threshold) || threshold === 0) return 'MODERATE';
      return ratioToStrength(Math.abs(value - threshold) / Math.abs(threshold));
    }

    case 'CONCENTRATION_DRIFT': {
      const weight = Number(context['weight'] ?? 0);
      const maxWeight = Number(context['maxWeight'] ?? 0);
      if (!Number.isFinite(weight) || !Number.isFinite(maxWeight) || maxWeight === 0) return 'MODERATE';
      return ratioToStrength(Math.abs(weight - maxWeight) / maxWeight);
    }

    case 'ALLOCATION_DRIFT': {
      // Per-ticker ETF-style: delta vs tolerance
      if (context['toleranceBps'] != null) {
        const delta = Math.abs(Number(context['delta'] ?? 0));
        const tolerance = Number(context['toleranceBps'] ?? 500) / 10_000;
        if (!Number.isFinite(delta) || !Number.isFinite(tolerance) || tolerance === 0) return 'MODERATE';
        return ratioToStrength(Math.abs(delta - tolerance) / tolerance);
      }
      // Strategy-level: drift vs driftThreshold
      const drift = Math.abs(Number(context['drift'] ?? 0));
      const driftThreshold = Number(context['driftThreshold'] ?? 0.05);
      if (!Number.isFinite(drift) || !Number.isFinite(driftThreshold) || driftThreshold === 0) return 'MODERATE';
      return ratioToStrength(Math.abs(drift - driftThreshold) / driftThreshold);
    }

    case 'DRAWDOWN': {
      const drawdown = Number(context['drawdown'] ?? 0);
      const threshold = Number(context['threshold'] ?? 0);
      if (!Number.isFinite(drawdown) || !Number.isFinite(threshold) || threshold === 0) return 'MODERATE';
      return ratioToStrength(Math.abs(drawdown - threshold) / Math.abs(threshold));
    }

    case 'EARNINGS_PROXIMITY': {
      const daysLeft = Number(context['daysUntilEarnings'] ?? 0);
      const withinDays = Number(context['withinDays'] ?? 7);
      if (!Number.isFinite(daysLeft) || !Number.isFinite(withinDays) || withinDays === 0) return 'MODERATE';
      // Ratio caps at 1.0 (daysLeft=0) — EARNINGS_PROXIMITY can never reach EXTREME
      const ratio = Math.min(1, Math.max(0, 1 - daysLeft / withinDays));
      return ratioToStrength(ratio);
    }

    case 'SIGNAL_PRESENT':
    case 'PERSON_ACTIVITY':
      return 'STRONG';

    default:
      return 'MODERATE';
  }
}

/** Pick the weakest strength in a group (AND semantics — chain fragility). */
export function aggregateGroupStrength(strengths: TriggerStrength[]): TriggerStrength {
  if (strengths.length === 0) return 'MODERATE';
  let weakest: TriggerStrength = strengths[0];
  for (let i = 1; i < strengths.length; i++) {
    if (STRENGTH_ORDER[strengths[i]] < STRENGTH_ORDER[weakest]) {
      weakest = strengths[i];
    }
  }
  return weakest;
}

/**
 * Pick the evaluation with the strongest triggerStrength (OR semantics — best justification).
 * When multiple groups tie, the first-declared group wins (stable ordering).
 */
export function pickStrongestGroup<T extends { triggerStrength: TriggerStrength }>(evaluations: T[]): T | undefined {
  if (evaluations.length === 0) return undefined;
  let best = evaluations[0];
  for (let i = 1; i < evaluations.length; i++) {
    if (STRENGTH_ORDER[evaluations[i].triggerStrength] > STRENGTH_ORDER[best.triggerStrength]) {
      best = evaluations[i];
    }
  }
  return best;
}
