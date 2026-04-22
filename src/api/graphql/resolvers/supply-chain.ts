/**
 * Supply-chain resolvers — `supplyChainMap(ticker)`,
 * `supplyChainMapsByTickers(tickers)`, `portfolioSupplyChainSummary`, and
 * `expandSupplyChainGraph(input)`.
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
 *
 * Phase C (progressive expansion): `expandSupplyChainGraph` delegates to a
 * wired expandFn, which resolves the source node to a Jintel entity, fetches
 * direction-filtered relationships, and runs the Opus classify/rank/label pass.
 * When no expandFn is wired (no Jintel / no ProviderRouter in this env), the
 * mutation returns an empty expansion rather than throwing — the UI treats
 * that as "nothing to append".
 */

import { aggregatePortfolioSupplyChain } from '../../../insights/supply-chain-aggregator.js';
import type { PortfolioSupplyChainSummary } from '../../../insights/supply-chain-aggregator.js';
import type { SupplyChainStore } from '../../../insights/supply-chain-store.js';
import type {
  SupplyChainDirection,
  SupplyChainExpansion,
  SupplyChainMap,
} from '../../../insights/supply-chain-types.js';
import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';

export type SupplyChainEnsureFn = (ticker: string) => Promise<SupplyChainMap | null>;

export interface ExpandSupplyChainGraphInput {
  sourceNodeId: string;
  direction: SupplyChainDirection;
  requestedTicker: string;
  hopDepth?: number | null;
  force?: boolean | null;
}

export type SupplyChainExpandFn = (input: ExpandSupplyChainGraphInput) => Promise<SupplyChainExpansion | null>;

let store: SupplyChainStore | undefined;
let ensureFn: SupplyChainEnsureFn | undefined;
let snapshotStore: PortfolioSnapshotStore | undefined;
let expandFn: SupplyChainExpandFn | undefined;

export function setSupplyChainStore(s: SupplyChainStore): void {
  store = s;
}

export function setSupplyChainEnsureFn(fn: SupplyChainEnsureFn | undefined): void {
  ensureFn = fn;
}

export function setSupplyChainSnapshotStore(s: PortfolioSnapshotStore): void {
  snapshotStore = s;
}

export function setSupplyChainExpandFn(fn: SupplyChainExpandFn | undefined): void {
  expandFn = fn;
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

export async function expandSupplyChainGraphMutation(
  _: unknown,
  args: { input: ExpandSupplyChainGraphInput },
): Promise<SupplyChainExpansion> {
  const { input } = args;
  if (!expandFn) {
    // Feature unavailable (no Jintel / no ProviderRouter wired). Return an
    // empty, well-formed expansion so the UI has something to merge — never
    // throw. Mirrors the Phase-A ensureFn degradation model.
    return emptyExpansion(input);
  }
  const result = await expandFn({
    sourceNodeId: input.sourceNodeId,
    direction: input.direction,
    requestedTicker: input.requestedTicker,
    hopDepth: input.hopDepth ?? undefined,
    force: input.force ?? undefined,
  });
  return result ?? emptyExpansion(input);
}

function emptyExpansion(input: ExpandSupplyChainGraphInput): SupplyChainExpansion {
  const now = new Date().toISOString();
  return {
    sourceNodeId: input.sourceNodeId,
    direction: input.direction,
    requestedTicker: input.requestedTicker,
    nodes: [],
    edges: [],
    reasoning: null,
    expandedAt: now,
    staleAfter: new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString(),
    synthesizedBy: null,
  };
}
