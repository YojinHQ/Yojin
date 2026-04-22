/**
 * SupplyChainBrief — compact render of a `SupplyChainMap` for inclusion in a
 * micro-analyst `DataBrief`.
 *
 * Phase A: read-only enrichment. The analyst uses this to factor upstream
 * dependencies and downstream demand into the neutral observation, citing
 * counterparty signals already in the archive. No new signals are emitted
 * from this path — that's a signal-ingestion concern (Phase B).
 */

import type { SupplyChainMap } from './supply-chain-types.js';
import type { SignalArchive } from '../signals/archive.js';
import type { Signal } from '../signals/types.js';

/** How many counterparties per side to include in the brief. */
const MAX_COUNTERPARTIES_PER_SIDE = 3;
/** How many recent signals per counterparty to cite. */
const MAX_SIGNALS_PER_COUNTERPARTY = 2;

export interface CounterpartyBrief {
  name: string;
  ticker: string | null;
  /** Present only on upstream edges (0..1). */
  criticality: number | null;
  /** Present only on upstream edges (supplier/partner/etc.). */
  relationship: string | null;
  /** Present only on downstream edges (0..1 share of revenue). */
  sharePct: number | null;
  /** Origin country ISO-2 (upstream only). */
  originCountry: string | null;
  /** Up to `MAX_SIGNALS_PER_COUNTERPARTY` recent titles for this counterparty. */
  recentSignals: CounterpartySignalBrief[];
}

export interface CounterpartySignalBrief {
  title: string;
  publishedAt: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL' | null;
}

export interface ConcentrationFlagBrief {
  dimension: 'PRODUCT' | 'SEGMENT' | 'GEOGRAPHY' | 'CUSTOMER';
  hhi: number;
  label: string;
}

export interface SupplyChainBrief {
  /** Max `source.asOf` across the edges used — how fresh the Jintel data is. */
  dataAsOf: string | null;
  upstream: CounterpartyBrief[];
  downstream: CounterpartyBrief[];
  concentrationFlags: ConcentrationFlagBrief[];
}

/**
 * Build a brief from a `SupplyChainMap`. Pulls recent counterparty signals
 * in a single `tickers: [...]` archive query (N+1 safe).
 *
 * Returns `null` when the map has no material content (no upstream, no
 * downstream, no concentration flags) so the formatter can skip the section.
 */
export async function buildSupplyChainBrief(
  map: SupplyChainMap | null,
  signalArchive: SignalArchive,
  signalsSince: string,
): Promise<SupplyChainBrief | null> {
  if (!map) return null;

  const upstream = map.upstream
    .slice()
    .sort((a, b) => b.criticality - a.criticality)
    .slice(0, MAX_COUNTERPARTIES_PER_SIDE);

  const downstream = map.downstream
    .slice()
    .sort((a, b) => (b.sharePct ?? 0) - (a.sharePct ?? 0))
    .slice(0, MAX_COUNTERPARTIES_PER_SIDE);

  if (upstream.length === 0 && downstream.length === 0 && map.concentrationRisks.length === 0) {
    return null;
  }

  // Single batch query across every counterparty ticker we care about.
  const tickerSet = new Set<string>();
  for (const e of upstream) if (e.counterpartyTicker) tickerSet.add(e.counterpartyTicker.toUpperCase());
  for (const e of downstream) if (e.counterpartyTicker) tickerSet.add(e.counterpartyTicker.toUpperCase());

  const signalsByTicker = tickerSet.size
    ? groupSignalsByTicker(
        await signalArchive.query({
          tickers: [...tickerSet],
          since: signalsSince,
          limit: tickerSet.size * MAX_SIGNALS_PER_COUNTERPARTY * 3, // headroom for sort
        }),
      )
    : new Map<string, Signal[]>();

  const upstreamBriefs: CounterpartyBrief[] = upstream.map((e) => ({
    name: e.counterpartyName,
    ticker: e.counterpartyTicker,
    criticality: e.criticality,
    relationship: e.relationship,
    sharePct: null,
    originCountry: e.originCountry,
    recentSignals: pickTopSignals(signalsByTicker.get((e.counterpartyTicker ?? '').toUpperCase()) ?? []),
  }));

  const downstreamBriefs: CounterpartyBrief[] = downstream.map((e) => ({
    name: e.counterpartyName,
    ticker: e.counterpartyTicker,
    criticality: null,
    relationship: null,
    sharePct: e.sharePct,
    originCountry: null,
    recentSignals: pickTopSignals(signalsByTicker.get((e.counterpartyTicker ?? '').toUpperCase()) ?? []),
  }));

  return {
    dataAsOf: map.dataAsOf,
    upstream: upstreamBriefs,
    downstream: downstreamBriefs,
    concentrationFlags: map.concentrationRisks.map((f) => ({
      dimension: f.dimension,
      hhi: f.hhi,
      label: f.label,
    })),
  };
}

function groupSignalsByTicker(signals: Signal[]): Map<string, Signal[]> {
  const map = new Map<string, Signal[]>();
  for (const s of signals) {
    for (const a of s.assets) {
      const key = a.ticker.toUpperCase();
      const list = map.get(key);
      if (list) list.push(s);
      else map.set(key, [s]);
    }
  }
  return map;
}

function pickTopSignals(signals: Signal[]): CounterpartySignalBrief[] {
  return signals
    .slice()
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
    .slice(0, MAX_SIGNALS_PER_COUNTERPARTY)
    .map((s) => ({
      title: s.tier1 ?? s.title,
      publishedAt: s.publishedAt,
      sentiment: s.sentiment ?? null,
    }));
}

/**
 * Format a `SupplyChainBrief` as compact markdown-ish text for the analyst
 * LLM context. Returns an empty string when the brief is null.
 */
export function formatSupplyChainBrief(brief: SupplyChainBrief | null): string {
  if (!brief) return '';

  const lines: string[] = [];
  const asOfLabel = brief.dataAsOf ? ` (data as of ${brief.dataAsOf})` : '';
  lines.push(`Supply chain${asOfLabel}:`);

  if (brief.upstream.length > 0) {
    lines.push('  Upstream (suppliers/partners, by criticality):');
    for (const c of brief.upstream) {
      const ticker = c.ticker ? ` [${c.ticker}]` : '';
      const origin = c.originCountry ? ` in ${c.originCountry}` : '';
      const crit = c.criticality != null ? ` — criticality ${c.criticality.toFixed(2)}` : '';
      const rel = c.relationship ? ` (${c.relationship.toLowerCase()})` : '';
      lines.push(`    - ${c.name}${ticker}${rel}${origin}${crit}`);
      for (const s of c.recentSignals) {
        const sent = s.sentiment ? ` [${s.sentiment}]` : '';
        lines.push(`      • ${s.publishedAt.slice(0, 10)}${sent} ${s.title}`);
      }
    }
  }

  if (brief.downstream.length > 0) {
    lines.push('  Downstream (customers, by revenue share):');
    for (const c of brief.downstream) {
      const ticker = c.ticker ? ` [${c.ticker}]` : '';
      const share = c.sharePct != null ? ` — ${(c.sharePct * 100).toFixed(1)}% of revenue` : '';
      lines.push(`    - ${c.name}${ticker}${share}`);
      for (const s of c.recentSignals) {
        const sent = s.sentiment ? ` [${s.sentiment}]` : '';
        lines.push(`      • ${s.publishedAt.slice(0, 10)}${sent} ${s.title}`);
      }
    }
  }

  if (brief.concentrationFlags.length > 0) {
    lines.push('  Concentration risks:');
    for (const f of brief.concentrationFlags) {
      lines.push(`    - ${f.dimension}: HHI ${f.hhi} — ${f.label}`);
    }
  }

  return lines.join('\n');
}
