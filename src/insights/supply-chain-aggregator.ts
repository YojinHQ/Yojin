/**
 * Portfolio-level aggregation over cached supply-chain maps.
 *
 * Pure in-memory: no Jintel calls, no LLM, no store writes. Consumes the
 * per-ticker maps already populated by `ensureSupplyChainMap` and produces a
 * cross-ticker rollup — "why it's a graph, not N narratives."
 *
 * Aggregations:
 * - `topCountryExposures` — upstream edges grouped by `originCountry`,
 *   weighted by criticality, with the set of portfolio tickers exposed.
 * - `sharedCounterparties` — upstream counterparties referenced by 2+
 *   portfolio tickers (e.g. TSMC across NVDA/AMD/AAPL).
 * - `singlePointsOfFailure` — high-criticality upstream edges with LOW
 *   substitutability. Phase B annotates substitutability; pre-synthesis
 *   maps contribute nothing here, which is the correct behavior.
 * - `concentrationStack` — per-ticker concentration flags above a minimum
 *   HHI threshold, sorted descending by HHI.
 */

import type { ConcentrationFlag, SupplyChainMap, UpstreamEdge } from './supply-chain-types.js';

/** HHI >= 2500 is the DOJ "highly concentrated" threshold. */
const CONCENTRATION_HHI_THRESHOLD = 2500;

/** Criticality cutoff above which a LOW-substitutability edge becomes a SPoF. */
const SPOF_CRITICALITY_THRESHOLD = 0.8;

export interface CountryExposure {
  iso2: string;
  country: string;
  /** Sum of upstream edge criticality for edges originating in this country. */
  criticalityWeightedCount: number;
  /** Portfolio tickers with at least one upstream edge in this country. */
  tickers: string[];
}

export interface SharedCounterparty {
  counterpartyName: string;
  counterpartyTicker: string | null;
  /** Portfolio tickers that depend on this counterparty upstream. */
  tickers: string[];
  count: number;
}

export interface SinglePointOfFailure {
  counterpartyName: string;
  ticker: string;
  reason: string;
}

export interface ConcentrationStackItem {
  ticker: string;
  flag: ConcentrationFlag;
}

export interface PortfolioSupplyChainSummary {
  topCountryExposures: CountryExposure[];
  sharedCounterparties: SharedCounterparty[];
  singlePointsOfFailure: SinglePointOfFailure[];
  concentrationStack: ConcentrationStackItem[];
}

export interface AggregateArgs {
  maps: SupplyChainMap[];
  /** Optional cap on rows per section. Defaults below. */
  topCountryLimit?: number;
  sharedCounterpartyLimit?: number;
  spofLimit?: number;
  concentrationLimit?: number;
}

export function aggregatePortfolioSupplyChain(args: AggregateArgs): PortfolioSupplyChainSummary {
  const { maps } = args;
  const topCountryLimit = args.topCountryLimit ?? 10;
  const sharedCounterpartyLimit = args.sharedCounterpartyLimit ?? 20;
  const spofLimit = args.spofLimit ?? 20;
  const concentrationLimit = args.concentrationLimit ?? 20;

  return {
    topCountryExposures: topCountryExposures(maps, topCountryLimit),
    sharedCounterparties: sharedCounterparties(maps, sharedCounterpartyLimit),
    singlePointsOfFailure: singlePointsOfFailure(maps, spofLimit),
    concentrationStack: concentrationStack(maps, concentrationLimit),
  };
}

// ---------------------------------------------------------------------------
// topCountryExposures
// ---------------------------------------------------------------------------

function topCountryExposures(maps: SupplyChainMap[], limit: number): CountryExposure[] {
  const byCountry = new Map<
    string,
    { iso2: string; country: string; criticalityWeightedCount: number; tickers: Set<string> }
  >();

  for (const map of maps) {
    for (const edge of map.upstream) {
      if (!edge.originCountry) continue;
      const iso2 = edge.originCountry.toUpperCase();
      const existing = byCountry.get(iso2);
      if (existing) {
        existing.criticalityWeightedCount += edge.criticality;
        existing.tickers.add(map.ticker);
      } else {
        byCountry.set(iso2, {
          iso2,
          country: lookupCountryName(iso2, map),
          criticalityWeightedCount: edge.criticality,
          tickers: new Set([map.ticker]),
        });
      }
    }
  }

  return [...byCountry.values()]
    .map((e) => ({
      iso2: e.iso2,
      country: e.country,
      criticalityWeightedCount: Number(e.criticalityWeightedCount.toFixed(3)),
      tickers: [...e.tickers].sort(),
    }))
    .sort((a, b) => b.criticalityWeightedCount - a.criticalityWeightedCount)
    .slice(0, limit);
}

/**
 * Prefer the country name already in the map's `geographicFootprint` when we
 * have one — keeps naming consistent with the per-ticker view. Fallback is
 * the ISO-2 code itself.
 */
function lookupCountryName(iso2: string, map: SupplyChainMap): string {
  const match = map.geographicFootprint.find((g) => g.iso2.toUpperCase() === iso2);
  return match?.country ?? iso2;
}

// ---------------------------------------------------------------------------
// sharedCounterparties
// ---------------------------------------------------------------------------

function sharedCounterparties(maps: SupplyChainMap[], limit: number): SharedCounterparty[] {
  const byKey = new Map<
    string,
    { counterpartyName: string; counterpartyTicker: string | null; tickers: Set<string> }
  >();

  for (const map of maps) {
    const seenThisMap = new Set<string>();
    for (const edge of map.upstream) {
      const key = counterpartyKey(edge);
      // Deduplicate within a single map — the same counterparty listed twice
      // under one ticker should count as one reference, not two.
      if (seenThisMap.has(key)) continue;
      seenThisMap.add(key);

      const existing = byKey.get(key);
      if (existing) {
        existing.tickers.add(map.ticker);
      } else {
        byKey.set(key, {
          counterpartyName: edge.counterpartyName,
          counterpartyTicker: edge.counterpartyTicker,
          tickers: new Set([map.ticker]),
        });
      }
    }
  }

  return [...byKey.values()]
    .filter((e) => e.tickers.size >= 2)
    .map((e) => ({
      counterpartyName: e.counterpartyName,
      counterpartyTicker: e.counterpartyTicker,
      tickers: [...e.tickers].sort(),
      count: e.tickers.size,
    }))
    .sort((a, b) => b.count - a.count || a.counterpartyName.localeCompare(b.counterpartyName))
    .slice(0, limit);
}

function counterpartyKey(edge: UpstreamEdge): string {
  if (edge.counterpartyTicker) return `T:${edge.counterpartyTicker.toUpperCase()}`;
  return `N:${edge.counterpartyName.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// singlePointsOfFailure
// ---------------------------------------------------------------------------

function singlePointsOfFailure(maps: SupplyChainMap[], limit: number): SinglePointOfFailure[] {
  const out: SinglePointOfFailure[] = [];
  for (const map of maps) {
    for (const edge of map.upstream) {
      if (edge.substitutability !== 'LOW') continue;
      if (edge.criticality < SPOF_CRITICALITY_THRESHOLD) continue;
      out.push({
        counterpartyName: edge.counterpartyName,
        ticker: map.ticker,
        reason: `criticality ${edge.criticality.toFixed(2)}, substitutability LOW`,
      });
    }
  }
  // Highest-criticality SPoFs first; tie-break by ticker for stability.
  out.sort((a, b) => {
    const ca = parseCriticality(a.reason);
    const cb = parseCriticality(b.reason);
    if (cb !== ca) return cb - ca;
    return a.ticker.localeCompare(b.ticker);
  });
  return out.slice(0, limit);
}

function parseCriticality(reason: string): number {
  const match = reason.match(/criticality\s+(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

// ---------------------------------------------------------------------------
// concentrationStack
// ---------------------------------------------------------------------------

function concentrationStack(maps: SupplyChainMap[], limit: number): ConcentrationStackItem[] {
  const out: ConcentrationStackItem[] = [];
  for (const map of maps) {
    for (const flag of map.concentrationRisks) {
      if (flag.hhi < CONCENTRATION_HHI_THRESHOLD) continue;
      out.push({ ticker: map.ticker, flag });
    }
  }
  out.sort((a, b) => b.flag.hhi - a.flag.hhi || a.ticker.localeCompare(b.ticker));
  return out.slice(0, limit);
}
