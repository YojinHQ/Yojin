/**
 * Snap resolver — returns the latest Strategist brief.
 *
 * Module-level state: setSnapStore is called once during server startup.
 */

import type { SnapStore } from '../../../snap/snap-store.js';
import type { Snap } from '../../../snap/types.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let store: SnapStore | null = null;

export function setSnapStore(s: SnapStore): void {
  store = s;
}

// ---------------------------------------------------------------------------
// GraphQL shape
// ---------------------------------------------------------------------------

interface SnapAttentionItemGql {
  label: string;
  severity: string;
  ticker: string | null;
}

interface SnapGql {
  id: string;
  generatedAt: string;
  summary: string;
  attentionItems: SnapAttentionItemGql[];
  portfolioTickers: string[];
}

function toGql(snap: Snap): SnapGql {
  return {
    id: snap.id,
    generatedAt: snap.generatedAt,
    summary: snap.summary,
    attentionItems: snap.attentionItems.map((item) => ({
      label: item.label,
      severity: item.severity,
      ticker: item.ticker ?? null,
    })),
    portfolioTickers: snap.portfolioTickers,
  };
}

// ---------------------------------------------------------------------------
// Query Resolver
// ---------------------------------------------------------------------------

export async function snapQuery(): Promise<SnapGql | null> {
  if (!store) return null;
  const snap = await store.getLatest();
  return snap ? toGql(snap) : null;
}
