/**
 * Phase A raw supply-chain map builder.
 *
 * Takes a hop-0 `Entity` (target) and hop-1 `Entity[]` (top counterparties)
 * and emits a `SupplyChainMap` with NO LLM synthesis:
 *
 * - `upstream`: edges where (direction=IN & type ∈ {PARTNER, OWNERSHIP}) OR
 *   (direction=OUT & type = SUBSIDIARY). All tagged `edgeOrigin=JINTEL_DIRECT`.
 * - `downstream`: edges where (direction=OUT & type ∈ {CUSTOMER, GOVERNMENT_CUSTOMER}).
 * - `criticality` (upstream): min-max normalized composite of (valueUsd, sharePct,
 *   confidence) across the upstream set. Single-edge / tied sets → 0.5.
 * - `evidence`: single-element array copied verbatim from Jintel's `RelationshipEdge.source`
 *   plus the edge's `context` string. Never synthesized.
 * - `geographicFootprint`: subsidiary jurisdictions rolled up by count, plus
 *   `concentration.geography.components`. Unknown jurisdictions are skipped.
 * - `concentrationRisks`: `deriveConcentrationRisks(entity.concentration)` — HHI
 *   >= 2500 OR top-3 share >= 0.6 fires the flag.
 * - `narrative`, `synthesizedBy`, `substitutability`: null.
 * - `dataAsOf`: max non-null `source.asOf` across all used edges.
 * - `staleAfter`: `asOf + 24h`.
 * - `sources`: de-duped by (connector, ref).
 *
 * Hop-1 entities are NOT used to fabricate new edges — they exist to enrich
 * future phases (Phase B narrative, Phase C brief). For Phase A, only hop-0 is
 * load-bearing.
 */

import type { Entity } from '@yojinhq/jintel-client';

import type { RelationshipEdge } from './supply-chain-jintel.js';
import {
  ConcentrationDimensionSchema,
  EdgeOriginSchema,
  SupplyChainMapSchema,
  SupplyChainRelationshipSchema,
} from './supply-chain-types.js';
import type {
  ConcentrationFlag,
  DownstreamEdge,
  Evidence,
  GeographicFootprintEntry,
  SupplyChainMap,
  SupplyChainSource,
  UpstreamEdge,
} from './supply-chain-types.js';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Jintel relationship type → Phase-A Yojin relationship label.
 *
 * - `PARTNER` (direction IN) and `OWNERSHIP` (direction IN) → PARTNER / JOINT_VENTURE.
 * - `SUBSIDIARY` (direction OUT) → MANUFACTURER (best-effort; subsidiaries are
 *   frequently manufacturing entities. This is a Phase-A heuristic; Phase B's
 *   LLM will refine).
 *
 * We avoid inventing SUPPLIER/DISTRIBUTOR/LICENSOR — Jintel doesn't currently
 * distinguish those, and guessing would be hallucination.
 */
const UPSTREAM_RELATIONSHIP_MAP: Record<
  'PARTNER' | 'OWNERSHIP' | 'SUBSIDIARY',
  'PARTNER' | 'JOINT_VENTURE' | 'MANUFACTURER'
> = {
  PARTNER: SupplyChainRelationshipSchema.enum.PARTNER,
  OWNERSHIP: SupplyChainRelationshipSchema.enum.JOINT_VENTURE,
  SUBSIDIARY: SupplyChainRelationshipSchema.enum.MANUFACTURER,
};

/**
 * Build the Phase-A raw supply-chain map from hop-0 + hop-1 Jintel data.
 *
 * `requestedTicker` is the ticker the caller used to fetch hop-0 — it's the
 * source of truth for the store's filename key. We never fall back to
 * `hop0.id` (an internal Jintel entity ID like `ent_aapl`), because the store
 * keys by `map.ticker` and a mismatch between the requested ticker and the
 * stored key means `store.get('AAPL')` would miss every subsequent call.
 */
export function buildRawSupplyChainMap(requestedTicker: string, hop0: Entity, _hop1: Entity[]): SupplyChainMap {
  const relationships: RelationshipEdge[] = hop0.relationships ?? [];

  const upstreamRaw = relationships.filter(isUpstreamEdge);
  const downstreamRaw = relationships.filter(isDownstreamEdge);

  const upstream = normalizeUpstream(upstreamRaw);
  const downstream = downstreamRaw.map(toDownstreamEdge);
  const geographicFootprint = buildGeographicFootprint(hop0);
  const concentrationRisks = deriveConcentrationRisks(hop0.concentration ?? null);

  const asOfIso = new Date().toISOString();
  const asOfMs = Date.parse(asOfIso);
  const staleAfterIso = new Date(asOfMs + STALE_AFTER_MS).toISOString();

  const usedEdges: RelationshipEdge[] = [...upstreamRaw, ...downstreamRaw];
  const dataAsOf = maxEdgeAsOf(usedEdges);
  const sources = dedupeSources(usedEdges);

  const map: SupplyChainMap = {
    ticker: requestedTicker.toUpperCase(),
    entityName: hop0.name,
    upstream,
    downstream,
    geographicFootprint,
    concentrationRisks,
    narrative: null,
    asOf: asOfIso,
    dataAsOf,
    staleAfter: staleAfterIso,
    sources,
    synthesizedBy: null,
  };

  // Schema parse round-trips the map so downstream consumers can't see an
  // invalid construct. Caller is responsible for catching if this throws.
  return SupplyChainMapSchema.parse(map);
}

// ---------------------------------------------------------------------------
// Edge classification
// ---------------------------------------------------------------------------

function isUpstreamEdge(e: RelationshipEdge): boolean {
  if (e.direction === 'IN' && (e.type === 'PARTNER' || e.type === 'OWNERSHIP')) return true;
  if (e.direction === 'OUT' && e.type === 'SUBSIDIARY') return true;
  return false;
}

function isDownstreamEdge(e: RelationshipEdge): boolean {
  return e.direction === 'OUT' && (e.type === 'CUSTOMER' || e.type === 'GOVERNMENT_CUSTOMER');
}

// ---------------------------------------------------------------------------
// Upstream — composite score + min-max normalization
// ---------------------------------------------------------------------------

function normalizeUpstream(edges: RelationshipEdge[]): UpstreamEdge[] {
  if (edges.length === 0) return [];
  const scored = edges.map((edge) => ({ edge, score: compositeScore(edge) }));
  const { min, max } = scoreBounds(scored.map((s) => s.score));
  const range = max - min;
  return scored.map(({ edge, score }) => {
    const criticality = range > 0 ? (score - min) / range : 0.5;
    return toUpstreamEdge(edge, criticality);
  });
}

function compositeScore(edge: RelationshipEdge): number {
  return (edge.valueUsd ?? 0) * 1e-9 + (edge.sharePct ?? 0) * 10 + edge.confidence * 5;
}

function scoreBounds(scores: number[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of scores) {
    if (s < min) min = s;
    if (s > max) max = s;
  }
  return { min, max };
}

function toUpstreamEdge(edge: RelationshipEdge, criticality: number): UpstreamEdge {
  const key = edge.type as 'PARTNER' | 'OWNERSHIP' | 'SUBSIDIARY';
  const relationship = UPSTREAM_RELATIONSHIP_MAP[key];
  return {
    counterpartyName: edge.counterpartyName,
    counterpartyTicker: edge.counterpartyTicker ?? null,
    counterpartyCik: edge.counterpartyCik ?? null,
    relationship,
    edgeOrigin: EdgeOriginSchema.enum.JINTEL_DIRECT,
    criticality,
    substitutability: null,
    evidence: [toEvidence(edge)],
    originCountry: null,
  };
}

// ---------------------------------------------------------------------------
// Downstream
// ---------------------------------------------------------------------------

function toDownstreamEdge(edge: RelationshipEdge): DownstreamEdge {
  return {
    counterpartyName: edge.counterpartyName,
    counterpartyTicker: edge.counterpartyTicker ?? null,
    edgeOrigin: EdgeOriginSchema.enum.JINTEL_DIRECT,
    sharePct: edge.sharePct ?? null,
    valueUsd: edge.valueUsd ?? null,
    evidence: [toEvidence(edge)],
  };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

function toEvidence(edge: RelationshipEdge): Evidence {
  return {
    connector: edge.source.connector,
    url: edge.source.url ?? null,
    ref: edge.source.ref ?? null,
    asOf: edge.source.asOf ?? null,
    contextQuote: edge.context ?? null,
  };
}

// ---------------------------------------------------------------------------
// Geographic footprint
// ---------------------------------------------------------------------------

/**
 * Minimal ISO-2 lookup. Covers the most common Jintel jurisdictions:
 * - US states / territories (all → US)
 * - Common foreign incorporation jurisdictions
 * Unknown → skipped (we don't emit an entry).
 */
const JURISDICTION_TO_ISO2: Record<string, { iso2: string; country: string }> = (() => {
  const US_STATES: Record<string, true> = Object.fromEntries(
    [
      'DELAWARE',
      'CALIFORNIA',
      'NEW YORK',
      'TEXAS',
      'FLORIDA',
      'NEVADA',
      'VIRGINIA',
      'WASHINGTON',
      'MASSACHUSETTS',
      'ILLINOIS',
      'COLORADO',
      'OREGON',
      'NEW JERSEY',
      'PENNSYLVANIA',
      'MARYLAND',
      'OHIO',
      'GEORGIA',
      'MICHIGAN',
      'MINNESOTA',
      'NORTH CAROLINA',
      'ARIZONA',
      'TENNESSEE',
      'INDIANA',
      'MISSOURI',
      'CONNECTICUT',
      'UTAH',
      'IOWA',
      'KANSAS',
      'OKLAHOMA',
      'ALABAMA',
      'LOUISIANA',
      'KENTUCKY',
      'WISCONSIN',
      'SOUTH CAROLINA',
      'HAWAII',
      'ALASKA',
      'NEBRASKA',
      'NEW HAMPSHIRE',
      'MAINE',
      'RHODE ISLAND',
      'VERMONT',
      'MONTANA',
      'WYOMING',
      'NORTH DAKOTA',
      'SOUTH DAKOTA',
      'IDAHO',
      'ARKANSAS',
      'MISSISSIPPI',
      'NEW MEXICO',
      'WEST VIRGINIA',
      'PUERTO RICO',
      'DISTRICT OF COLUMBIA',
    ].map((s) => [s, true]),
  );
  const map: Record<string, { iso2: string; country: string }> = {};
  for (const state of Object.keys(US_STATES)) {
    map[state] = { iso2: 'US', country: 'United States' };
  }
  const others: Array<[string, string, string]> = [
    ['UNITED STATES', 'US', 'United States'],
    ['USA', 'US', 'United States'],
    ['US', 'US', 'United States'],
    ['CANADA', 'CA', 'Canada'],
    ['MEXICO', 'MX', 'Mexico'],
    ['IRELAND', 'IE', 'Ireland'],
    ['UNITED KINGDOM', 'GB', 'United Kingdom'],
    ['UK', 'GB', 'United Kingdom'],
    ['ENGLAND', 'GB', 'United Kingdom'],
    ['SCOTLAND', 'GB', 'United Kingdom'],
    ['GERMANY', 'DE', 'Germany'],
    ['FRANCE', 'FR', 'France'],
    ['NETHERLANDS', 'NL', 'Netherlands'],
    ['LUXEMBOURG', 'LU', 'Luxembourg'],
    ['SWITZERLAND', 'CH', 'Switzerland'],
    ['SWEDEN', 'SE', 'Sweden'],
    ['SPAIN', 'ES', 'Spain'],
    ['ITALY', 'IT', 'Italy'],
    ['BELGIUM', 'BE', 'Belgium'],
    ['DENMARK', 'DK', 'Denmark'],
    ['FINLAND', 'FI', 'Finland'],
    ['NORWAY', 'NO', 'Norway'],
    ['AUSTRIA', 'AT', 'Austria'],
    ['POLAND', 'PL', 'Poland'],
    ['CHINA', 'CN', 'China'],
    ['HONG KONG', 'HK', 'Hong Kong'],
    ['JAPAN', 'JP', 'Japan'],
    ['SOUTH KOREA', 'KR', 'South Korea'],
    ['KOREA', 'KR', 'South Korea'],
    ['TAIWAN', 'TW', 'Taiwan'],
    ['SINGAPORE', 'SG', 'Singapore'],
    ['INDIA', 'IN', 'India'],
    ['AUSTRALIA', 'AU', 'Australia'],
    ['NEW ZEALAND', 'NZ', 'New Zealand'],
    ['BRAZIL', 'BR', 'Brazil'],
    ['ISRAEL', 'IL', 'Israel'],
    ['CAYMAN ISLANDS', 'KY', 'Cayman Islands'],
    ['BRITISH VIRGIN ISLANDS', 'VG', 'British Virgin Islands'],
    ['BERMUDA', 'BM', 'Bermuda'],
    ['BAHAMAS', 'BS', 'Bahamas'],
    ['UNITED ARAB EMIRATES', 'AE', 'United Arab Emirates'],
    ['UAE', 'AE', 'United Arab Emirates'],
  ];
  for (const [name, iso2, country] of others) {
    map[name] = { iso2, country };
  }
  return map;
})();

function normalizeJurisdiction(raw: string | null | undefined): { iso2: string; country: string } | null {
  if (!raw) return null;
  const key = raw.trim().toUpperCase();
  if (key.length === 0) return null;
  // Direct hit on full name or alias.
  const hit = JURISDICTION_TO_ISO2[key];
  if (hit) return hit;
  // Bare ISO-2 (e.g. "KR", "DE") that we didn't enumerate — accept as-is.
  if (/^[A-Z]{2}$/.test(key)) {
    return { iso2: key, country: key };
  }
  return null;
}

function buildGeographicFootprint(hop0: Entity): GeographicFootprintEntry[] {
  const buckets = new Map<string, { country: string; count: number; entities: Set<string> }>();

  // Subsidiary jurisdictions.
  const subList = hop0.subsidiaries;
  const subs = subList?.subsidiaries ?? [];
  for (const sub of subs) {
    const loc = normalizeJurisdiction(sub.jurisdiction);
    if (!loc) continue;
    const bucket = buckets.get(loc.iso2) ?? { country: loc.country, count: 0, entities: new Set<string>() };
    bucket.count += 1;
    bucket.entities.add(sub.name);
    buckets.set(loc.iso2, bucket);
  }

  // Concentration.geography components (additive — treat each component as
  // another count unit so regions with reported revenue still surface even
  // when no subsidiary is incorporated there).
  const geoSnap = hop0.concentration?.geography;
  const geoComponents = geoSnap?.components ?? [];
  for (const comp of geoComponents) {
    const loc = normalizeJurisdiction(comp.label);
    if (!loc) continue;
    const bucket = buckets.get(loc.iso2) ?? { country: loc.country, count: 0, entities: new Set<string>() };
    bucket.count += 1;
    bucket.entities.add(comp.label);
    buckets.set(loc.iso2, bucket);
  }

  if (buckets.size === 0) return [];

  const maxCount = Math.max(...[...buckets.values()].map((b) => b.count));
  const entries: GeographicFootprintEntry[] = [];
  for (const [iso2, bucket] of buckets) {
    entries.push({
      iso2,
      country: bucket.country,
      criticality: maxCount > 0 ? bucket.count / maxCount : 0,
      entities: [...bucket.entities],
    });
  }
  entries.sort((a, b) => b.criticality - a.criticality);
  return entries;
}

// ---------------------------------------------------------------------------
// Concentration risks (deterministic)
// ---------------------------------------------------------------------------

type ConcentrationSnapshot = NonNullable<NonNullable<Entity['concentration']>['customer']>;

/**
 * HHI >= 2500 (DOJ/FTC "highly concentrated" threshold) OR top-3 share >= 0.6
 * fires the flag. Skips snapshots with null HHI or empty components.
 */
export function deriveConcentrationRisks(concentration: Entity['concentration'] | null): ConcentrationFlag[] {
  const flags: ConcentrationFlag[] = [];
  if (!concentration) return flags;

  const push = (
    dimension: 'PRODUCT' | 'SEGMENT' | 'GEOGRAPHY' | 'CUSTOMER',
    snap: ConcentrationSnapshot | null | undefined,
  ) => {
    if (!snap) return;
    const hhi = snap.hhi ?? null;
    if (hhi === null || !Number.isFinite(hhi)) return;
    const components = [...(snap.components ?? [])].sort((a, b) => b.share - a.share);
    const top3 = components.slice(0, 3);
    if (top3.length === 0) return;
    const top3Share = top3.reduce((s, c) => s + c.share, 0);
    if (hhi >= 2500 || top3Share >= 0.6) {
      const dimLabel = dimension.toLowerCase();
      flags.push({
        dimension: ConcentrationDimensionSchema.enum[dimension],
        hhi: clampHhi(hhi),
        label: `Top-${top3.length} ${dimLabel} = ${(top3Share * 100).toFixed(0)}% (HHI ${Math.round(hhi)})`,
      });
    }
  };

  push('PRODUCT', concentration.product ?? null);
  push('SEGMENT', concentration.segment ?? null);
  push('GEOGRAPHY', concentration.geography ?? null);
  push('CUSTOMER', concentration.customer ?? null);
  return flags;
}

function clampHhi(hhi: number): number {
  // Schema requires 0..10000 — clamp defensively in case upstream edge case
  // pushes slightly above.
  return Math.max(0, Math.min(10_000, hhi));
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

function maxEdgeAsOf(edges: RelationshipEdge[]): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const edge of edges) {
    const asOf = edge.source.asOf ?? null;
    if (!asOf) continue;
    const ms = Date.parse(asOf);
    if (!Number.isFinite(ms)) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = asOf;
    }
  }
  return best;
}

function dedupeSources(edges: RelationshipEdge[]): SupplyChainSource[] {
  const seen = new Set<string>();
  const out: SupplyChainSource[] = [];
  for (const edge of edges) {
    const connector = edge.source.connector;
    const ref = edge.source.ref ?? null;
    const key = `${connector}|${ref ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ connector, asOf: edge.source.asOf ?? null, ref });
  }
  return out;
}
