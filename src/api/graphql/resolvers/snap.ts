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

interface SnapActionItemGql {
  text: string;
  signalIds: string[];
}

interface AssetSnapGql {
  symbol: string;
  snap: string;
  rating: string;
  generatedAt: string;
}

interface SnapGql {
  id: string;
  generatedAt: string;
  intelSummary: string;
  actionItems: SnapActionItemGql[];
  assetSnaps: AssetSnapGql[];
}

function toGql(snap: Snap): SnapGql {
  return {
    id: snap.id,
    generatedAt: snap.generatedAt,
    intelSummary: snap.intelSummary ?? '',
    actionItems: snap.actionItems.map((item) => ({
      text: item.text,
      signalIds: item.signalIds,
    })),
    assetSnaps: (snap.assetSnaps ?? []).map((as) => ({
      symbol: as.symbol,
      snap: as.snap,
      rating: as.rating,
      generatedAt: as.generatedAt,
    })),
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
