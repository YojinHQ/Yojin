import { z } from 'zod';

import type { TriggerGroup } from './types.js';

export const DataCapabilitySchema = z.enum([
  'market_data',
  'technicals',
  'news',
  'research',
  'sentiment',
  'fundamentals',
  'filings',
  'derivatives',
  'portfolio',
  'macro_data',
]);
export type DataCapability = z.infer<typeof DataCapabilitySchema>;

const AVAILABLE_CAPABILITIES: DataCapability[] = [
  'market_data',
  'technicals',
  'news',
  'research',
  'sentiment',
  'fundamentals',
  'filings',
  'derivatives',
  'portfolio',
  'macro_data',
];

export function getAvailableCapabilities(): DataCapability[] {
  return [...AVAILABLE_CAPABILITIES];
}

export interface CapabilityCheckResult {
  required: DataCapability[];
  available: DataCapability[];
  missing: DataCapability[];
  status: 'executable' | 'limited' | 'unavailable';
}

// ---------------------------------------------------------------------------
// Auto-derive capabilities from trigger groups
// ---------------------------------------------------------------------------

const TRIGGER_TYPE_CAPABILITIES: Record<string, DataCapability[]> = {
  PRICE_MOVE: ['market_data'],
  INDICATOR_THRESHOLD: ['technicals'],
  CONCENTRATION_DRIFT: ['portfolio'],
  ALLOCATION_DRIFT: ['portfolio'],
  DRAWDOWN: ['market_data', 'portfolio'],
  EARNINGS_PROXIMITY: ['fundamentals'],
  METRIC_THRESHOLD: [],
  SIGNAL_PRESENT: ['news'],
  PERSON_ACTIVITY: ['filings'],
  CUSTOM: [],
};

const SIGNAL_TYPE_CAPABILITIES: Record<string, DataCapability> = {
  NEWS: 'news',
  FUNDAMENTAL: 'fundamentals',
  SENTIMENT: 'sentiment',
  TECHNICAL: 'technicals',
  MACRO: 'macro_data',
  FILINGS: 'filings',
  SOCIALS: 'sentiment',
  REGULATORY: 'filings',
  DISCLOSED_TRADE: 'filings',
  TRADING_LOGIC_TRIGGER: 'market_data',
};

const METRIC_CAPABILITIES: Record<string, DataCapability> = {
  SUE: 'fundamentals',
  priceToBook: 'fundamentals',
  bookValue: 'fundamentals',
  roe: 'fundamentals',
  sentiment_momentum_24h: 'sentiment',
};

/** Derive required DataCapabilities from trigger groups. */
export function deriveCapabilities(triggerGroups: TriggerGroup[]): DataCapability[] {
  const caps = new Set<DataCapability>();

  for (const group of triggerGroups) {
    for (const condition of group.conditions) {
      const base = TRIGGER_TYPE_CAPABILITIES[condition.type];
      if (base) base.forEach((c) => caps.add(c));

      const params = condition.params ?? {};

      // SIGNAL_PRESENT: derive from signal_types
      if (condition.type === 'SIGNAL_PRESENT' && Array.isArray(params['signal_types'])) {
        for (const st of params['signal_types']) {
          const cap = SIGNAL_TYPE_CAPABILITIES[String(st)];
          if (cap) caps.add(cap);
        }
      }

      // METRIC_THRESHOLD: derive from metric name
      if (condition.type === 'METRIC_THRESHOLD' && params['metric']) {
        const cap = METRIC_CAPABILITIES[String(params['metric'])];
        caps.add(cap ?? 'fundamentals');
      }
    }
  }

  return [...caps];
}

export function checkCapabilities(
  requires: DataCapability[],
  availableOverride?: DataCapability[],
): CapabilityCheckResult {
  const availableSet = new Set(availableOverride ?? AVAILABLE_CAPABILITIES);
  const available = requires.filter((r) => availableSet.has(r));
  const missing = requires.filter((r) => !availableSet.has(r));

  let status: CapabilityCheckResult['status'];
  if (missing.length === 0) status = 'executable';
  else if (available.length > 0) status = 'limited';
  else status = 'unavailable';

  return { required: requires, available, missing, status };
}
