/**
 * Supply-chain resolvers — `supplyChainMap(ticker)` and
 * `supplyChainMapsByTickers(tickers)`.
 *
 * Phase A: on query, call the wired ensureFn (which cache-hits from
 * `SupplyChainStore` or builds from Jintel on miss / stale). If no runner is
 * wired (e.g. no Jintel client in this environment), fall back to reading the
 * store directly. The feature degrades to null / [] silently when the store
 * has nothing.
 */

import type { SupplyChainStore } from '../../../insights/supply-chain-store.js';
import type { SupplyChainMap } from '../../../insights/supply-chain-types.js';

export type SupplyChainEnsureFn = (ticker: string) => Promise<SupplyChainMap | null>;

let store: SupplyChainStore | undefined;
let ensureFn: SupplyChainEnsureFn | undefined;

export function setSupplyChainStore(s: SupplyChainStore): void {
  store = s;
}

export function setSupplyChainEnsureFn(fn: SupplyChainEnsureFn | undefined): void {
  ensureFn = fn;
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
