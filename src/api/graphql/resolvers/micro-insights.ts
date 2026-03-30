/**
 * Micro insight resolvers — microInsight(symbol) and microInsights queries.
 */

import type { MicroInsightStore } from '../../../insights/micro-insight-store.js';

let store: MicroInsightStore | undefined;

export function setMicroInsightStore(s: MicroInsightStore): void {
  store = s;
}

export async function microInsightQuery(_: unknown, args: { symbol: string }) {
  if (!store) return null;
  return store.getLatest(args.symbol);
}

export async function microInsightsQuery() {
  if (!store) return [];
  const map = await store.getAllLatest();
  return [...map.values()];
}
