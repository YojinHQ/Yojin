/**
 * Transform SupplyChainMap[] + portfolio tickers into force-graph nodes/links.
 *
 * Node kinds:
 * - `portfolio` — a ticker the user holds (anchors the view)
 * - `counterparty` — a supplier/customer referenced by at least one portfolio map
 *
 * Edge colour encodes substitutability (LOW = bottleneck, HIGH = resilient,
 * null = not yet annotated). Portfolio nodes are sized by count of upstream +
 * downstream edges; counterparties are sized by how many portfolio tickers
 * depend on them (shared counterparties become hubs).
 *
 * Pure function — no DOM, no React. Fully unit-testable.
 */

import type { Substitutability, SupplyChainMap } from '../api/types';

export type GraphNodeKind = 'portfolio' | 'counterparty';

export type GraphEdgeKind = 'upstream' | 'downstream';

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  /** Number of portfolio tickers that touch this node (always >=1). */
  portfolioDegree: number;
  /**
   * Country ISO-2 if any upstream edge into this counterparty declared one.
   * Portfolio nodes leave this null — their country footprint lives on the
   * incoming edges.
   */
  country: string | null;
  /**
   * Highest-risk substitutability across all incoming upstream edges.
   * LOW takes priority over MEDIUM, MEDIUM over HIGH. `null` means no
   * upstream edge was annotated (Phase A-only map or downstream-only node).
   */
  worstSubstitutability: Substitutability | null;
  /** True when this counterparty is referenced by 2+ portfolio tickers. */
  shared: boolean;
  /** True when any incoming upstream edge is a LOW-subst SPoF. */
  bottleneck: boolean;
}

export interface GraphLink {
  source: string;
  target: string;
  kind: GraphEdgeKind;
  substitutability: Substitutability | null;
  criticality: number;
  relationship: string;
  sharePct: number | null;
  originCountry: string | null;
}

export interface SupplyChainGraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** Criticality threshold above which a LOW-subst edge is flagged as a SPoF. */
const SPOF_CRITICALITY_THRESHOLD = 0.8;

/** Worst-case wins: LOW > MEDIUM > HIGH > null. */
function worseSubstitutability(a: Substitutability | null, b: Substitutability | null): Substitutability | null {
  const rank = (s: Substitutability | null): number => {
    if (s === 'LOW') return 3;
    if (s === 'MEDIUM') return 2;
    if (s === 'HIGH') return 1;
    return 0;
  };
  return rank(a) >= rank(b) ? a : b;
}

/** Stable id for a counterparty — prefer ticker, fall back to name. */
function counterpartyId(ticker: string | null, name: string): string {
  if (ticker && ticker.trim().length > 0) return ticker.toUpperCase();
  return `name:${name.trim().toLowerCase()}`;
}

export interface BuildGraphArgs {
  maps: SupplyChainMap[];
  /**
   * Portfolio tickers. Passed separately so tickers without a cached map still
   * appear as isolated portfolio nodes — better than silently dropping them.
   */
  portfolioTickers: string[];
}

export function buildSupplyChainGraph(args: BuildGraphArgs): SupplyChainGraphData {
  const nodesById = new Map<string, GraphNode>();
  const links: GraphLink[] = [];

  // Seed portfolio nodes first so IDs are stable and shared-counterparty
  // deduplication can check membership.
  const portfolioIds = new Set(args.portfolioTickers.map((t) => t.toUpperCase()));
  for (const ticker of portfolioIds) {
    nodesById.set(ticker, {
      id: ticker,
      label: ticker,
      kind: 'portfolio',
      portfolioDegree: 1,
      country: null,
      worstSubstitutability: null,
      shared: false,
      bottleneck: false,
    });
  }

  // Index maps by uppercase ticker so we can enrich the portfolio node label
  // with the entity name when available.
  const mapsByTicker = new Map<string, SupplyChainMap>();
  for (const m of args.maps) mapsByTicker.set(m.ticker.toUpperCase(), m);

  for (const [ticker, node] of nodesById) {
    const map = mapsByTicker.get(ticker);
    if (map?.entityName) node.label = map.entityName;
  }

  // Walk each map, materialising counterparty nodes + edges.
  for (const map of args.maps) {
    const sourceId = map.ticker.toUpperCase();
    if (!nodesById.has(sourceId)) {
      // Map returned for a ticker that isn't in the portfolio — still render
      // it as a portfolio node so the edges have a home.
      nodesById.set(sourceId, {
        id: sourceId,
        label: map.entityName || sourceId,
        kind: 'portfolio',
        portfolioDegree: 1,
        country: null,
        worstSubstitutability: null,
        shared: false,
        bottleneck: false,
      });
    }

    for (const edge of map.upstream) {
      const id = counterpartyId(edge.counterpartyTicker, edge.counterpartyName);
      // Never render a counterparty node that collides with a portfolio
      // ticker — that would add a self-link. Skip the node, still emit the
      // edge targeting the portfolio node so the relationship is visible.
      const existing = nodesById.get(id);
      if (existing) {
        if (existing.kind === 'counterparty') {
          existing.portfolioDegree += 1;
          existing.shared = existing.portfolioDegree >= 2;
        }
        existing.worstSubstitutability = worseSubstitutability(existing.worstSubstitutability, edge.substitutability);
        if (edge.originCountry && !existing.country) {
          existing.country = edge.originCountry;
        }
        if (edge.substitutability === 'LOW' && edge.criticality >= SPOF_CRITICALITY_THRESHOLD) {
          existing.bottleneck = true;
        }
      } else {
        nodesById.set(id, {
          id,
          label: edge.counterpartyName,
          kind: 'counterparty',
          portfolioDegree: 1,
          country: edge.originCountry ?? null,
          worstSubstitutability: edge.substitutability ?? null,
          shared: false,
          bottleneck: edge.substitutability === 'LOW' && edge.criticality >= SPOF_CRITICALITY_THRESHOLD,
        });
      }

      links.push({
        source: sourceId,
        target: id,
        kind: 'upstream',
        substitutability: edge.substitutability ?? null,
        criticality: edge.criticality,
        relationship: edge.relationship,
        sharePct: null,
        originCountry: edge.originCountry ?? null,
      });
    }

    for (const edge of map.downstream) {
      const id = counterpartyId(edge.counterpartyTicker, edge.counterpartyName);
      const existing = nodesById.get(id);
      if (existing) {
        if (existing.kind === 'counterparty') {
          existing.portfolioDegree += 1;
          existing.shared = existing.portfolioDegree >= 2;
        }
      } else {
        nodesById.set(id, {
          id,
          label: edge.counterpartyName,
          kind: 'counterparty',
          portfolioDegree: 1,
          country: null,
          worstSubstitutability: null,
          shared: false,
          bottleneck: false,
        });
      }
      links.push({
        source: sourceId,
        target: id,
        kind: 'downstream',
        substitutability: null,
        criticality: 0,
        relationship: 'CUSTOMER',
        sharePct: edge.sharePct ?? null,
        originCountry: null,
      });
    }
  }

  return {
    nodes: [...nodesById.values()],
    links,
  };
}

/** Tailwind-compatible hex for substitutability. Exported for the legend. */
export function substitutabilityColor(s: Substitutability | null): string {
  switch (s) {
    case 'LOW':
      return '#ef4444'; // red-500 — bottleneck
    case 'MEDIUM':
      return '#f59e0b'; // amber-500
    case 'HIGH':
      return '#22c55e'; // green-500 — resilient
    default:
      return '#64748b'; // slate-500 — unknown
  }
}
