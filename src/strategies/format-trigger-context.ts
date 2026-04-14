/**
 * Format the `context` record produced by StrategyEvaluator into a human-readable
 * list of `label: value` lines for action display and LLM prompts.
 *
 * Pairing rule: `value`, `threshold`, and `previous` belong to the same metric.
 * The threshold's magnitude tells us whether the metric is fractional (e.g. 0.20
 * = 20%) or absolute (e.g. RSI 30). Display all three under one scale so the
 * UI doesn't show `value: 4.50` against `threshold: 20.0%` for the same trigger.
 */

const PAIRED_KEYS = new Set(['value', 'threshold', 'previous']);

/** Keys whose numeric values are always fractions of 1 (display as %). */
const ALWAYS_FRACTIONAL_KEYS = new Set([
  'change',
  'weight',
  'maxWeight',
  'drift',
  'driftThreshold',
  'delta',
  'target',
  'actual',
  'drawdown',
  'targetAllocation',
  'actualAllocation',
]);

function humanLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim();
}

function formatPercent(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function formatTriggerContext(context: Record<string, unknown>): string[] {
  // Pair value/threshold/previous: if a threshold exists and looks fractional
  // (|t| ≤ 1), display all three under percent — even when value exceeds ±100%.
  const rawThreshold = context['threshold'];
  const treatPairedAsPercent =
    typeof rawThreshold === 'number' && Number.isFinite(rawThreshold) && Math.abs(rawThreshold) <= 1;

  const parts: string[] = [];
  for (const [k, v] of Object.entries(context)) {
    if (k === 'ticker') continue;
    const label = humanLabel(k);

    let val: string;
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (PAIRED_KEYS.has(k)) {
        val = treatPairedAsPercent ? formatPercent(v) : v.toFixed(2);
      } else if (ALWAYS_FRACTIONAL_KEYS.has(k)) {
        val = formatPercent(v);
      } else if (v > -1 && v < 1) {
        val = formatPercent(v);
      } else {
        val = v.toFixed(2);
      }
    } else {
      val = String(v);
    }
    parts.push(`${label}: ${val}`);
  }
  return parts;
}
