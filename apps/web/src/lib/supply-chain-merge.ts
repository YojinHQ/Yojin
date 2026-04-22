/**
 * Pure merge of a progressive supply-chain expansion into an existing graph.
 *
 * Contract:
 * - Nodes dedupe by `id`. When an incoming node collides with an existing one,
 *   the existing node is kept (preserves its `x` / `y` position already
 *   computed by the force-graph simulation). Incoming label/rank updates are
 *   applied without touching position fields.
 * - Edges dedupe by `${sourceId}->${targetId}|${relationship}` — this keeps
 *   two different relationships between the same pair distinct, but prevents
 *   duplicate re-runs of the same chip from stacking identical edges.
 * - The function is pure — no React, no DOM — so it can be unit-tested in a
 *   vitest environment without a DOM shim.
 *
 * Types mirror `SupplyChainExpansion` but are wider than the GraphQL-derived
 * `SupplyChainExpansionNode` so callers can pass already-positioned nodes from
 * the force simulation.
 */

import type { SupplyChainExpansion, SupplyChainExpansionNode, SupplyChainExpansionEdge } from '../api/types.js';

/**
 * A node inside the rendered graph. Extends the GraphQL node type with the
 * optional x/y coordinates maintained by `react-force-graph-2d`. Extra fields
 * from the force sim are preserved via an open object shape.
 */
export interface GraphNode extends SupplyChainExpansionNode {
  x?: number;
  y?: number;
  /** Force-graph stamps additional fields (vx, vy, fx, fy) — keep the type open. */
  [extra: string]: unknown;
}

export type GraphEdge = SupplyChainExpansionEdge;

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function edgeKey(edge: Pick<GraphEdge, 'sourceId' | 'targetId' | 'relationship'>): string {
  return `${edge.sourceId}->${edge.targetId}|${edge.relationship}`;
}

export function mergeExpansionIntoGraph(current: GraphData, expansion: SupplyChainExpansion): GraphData {
  // --- Nodes ----------------------------------------------------------------
  const nodeById = new Map<string, GraphNode>();
  for (const node of current.nodes) {
    nodeById.set(node.id, node);
  }
  for (const incoming of expansion.nodes) {
    const existing = nodeById.get(incoming.id);
    if (existing) {
      // Preserve existing position + any force-sim fields, apply fresh label/rank/metadata.
      nodeById.set(incoming.id, {
        ...existing,
        label: incoming.label,
        ticker: incoming.ticker,
        cik: incoming.cik,
        nodeKind: incoming.nodeKind,
        countryCode: incoming.countryCode,
        rank: incoming.rank,
      });
    } else {
      nodeById.set(incoming.id, { ...incoming });
    }
  }

  // --- Edges ----------------------------------------------------------------
  const edgeByKey = new Map<string, GraphEdge>();
  for (const edge of current.edges) {
    edgeByKey.set(edgeKey(edge), edge);
  }
  for (const incoming of expansion.edges) {
    edgeByKey.set(edgeKey(incoming), incoming);
  }

  return {
    nodes: Array.from(nodeById.values()),
    edges: Array.from(edgeByKey.values()),
  };
}
