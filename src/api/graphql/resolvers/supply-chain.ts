/**
 * Supply-chain resolvers — `supplyChainMap(ticker)`,
 * `supplyChainMapsByTickers(tickers)`, and `portfolioSupplyChainSummary`.
 *
 * Phase A: on query, call the wired ensureFn (which cache-hits from
 * `SupplyChainStore` or builds from Jintel on miss / stale). If no runner is
 * wired (e.g. no Jintel client in this environment), fall back to reading the
 * store directly. The feature degrades to null / [] silently when the store
 * has nothing.
 *
 * Phase C.5: `portfolioSupplyChainSummary` reads maps for every portfolio
 * ticker (via the same ensureFn) and aggregates in memory — no new Jintel
 * calls, no LLM.
 */

import { aggregatePortfolioSupplyChain } from '../../../insights/supply-chain-aggregator.js';
import type { PortfolioSupplyChainSummary } from '../../../insights/supply-chain-aggregator.js';
import type { SupplyChainStore } from '../../../insights/supply-chain-store.js';
import type { SupplyChainMap } from '../../../insights/supply-chain-types.js';
import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';

export type SupplyChainEnsureFn = (ticker: string) => Promise<SupplyChainMap | null>;

let store: SupplyChainStore | undefined;
let ensureFn: SupplyChainEnsureFn | undefined;
let snapshotStore: PortfolioSnapshotStore | undefined;

export function setSupplyChainStore(s: SupplyChainStore): void {
  store = s;
}

export function setSupplyChainEnsureFn(fn: SupplyChainEnsureFn | undefined): void {
  ensureFn = fn;
}

export function setSupplyChainSnapshotStore(s: PortfolioSnapshotStore): void {
  snapshotStore = s;
}

async function resolveOne(ticker: string): Promise<SupplyChainMap | null> {
  if (ensureFn) return ensureFn(ticker);
  if (store) return store.get(ticker);
  return null;
}

export async function supplyChainMapQuery(_: unknown, args: { ticker: string }): Promise<SupplyChainMap | null> {
  return resolveOne(args.ticker);
}

export async function supplyChainMapsByTickersQuery(
  _: unknown,
  args: { tickers: string[] },
): Promise<SupplyChainMap[]> {
  const results = await Promise.all(args.tickers.map((t) => resolveOne(t)));
  return results.filter((m): m is SupplyChainMap => m !== null);
}

const EMPTY_SUMMARY: PortfolioSupplyChainSummary = {
  topCountryExposures: [],
  sharedCounterparties: [],
  singlePointsOfFailure: [],
  concentrationStack: [],
};

export async function portfolioSupplyChainSummaryQuery(): Promise<PortfolioSupplyChainSummary> {
  if (!snapshotStore) return EMPTY_SUMMARY;
  const snapshot = await snapshotStore.getLatest();
  if (!snapshot || snapshot.positions.length === 0) return EMPTY_SUMMARY;

  // Deduplicate tickers across platforms — the same symbol on two brokers
  // should still only pull one supply-chain map.
  const tickers = [...new Set(snapshot.positions.map((p) => p.symbol.toUpperCase()))];
  const maps = (await Promise.all(tickers.map((t) => resolveOne(t)))).filter((m): m is SupplyChainMap => m !== null);

  return aggregatePortfolioSupplyChain({ maps });
}
