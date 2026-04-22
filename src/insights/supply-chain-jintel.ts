/**
 * Jintel fetchers + deterministic ranking for the supply-chain map (Phase A).
 *
 * Three exports:
 * - `fetchSupplyChainHop0(client, ticker)` — fetches the target's relationships,
 *   subsidiaries, and concentration in one batchEnrich call.
 * - `rankCounterparties(edges)` — picks up to 8 unique counterparty tickers
 *   from hop-0 edges using a composite (value, share, confidence, type) score.
 * - `fetchSupplyChainHop1(client, tickers)` — one batchEnrich over those
 *   counterparties for lighter-weight hop-1 context.
 */

import type { Entity, JintelClient } from '@yojinhq/jintel-client';

/**
 * Derive the edge type from `Entity` — the upstream package doesn't re-export
 * `RelationshipEdge` from its root, but the inline type on `Entity.relationships`
 * is structurally identical and kept in lockstep by Zod.
 */
export type RelationshipEdge = NonNullable<Entity['relationships']>[number];

/**
 * Jintel's `batchEnrich` accepts up to 20 tickers per call. `rankCounterparties`
 * caps at 8 so chunking is never needed — but documenting the cap here avoids
 * surprise if someone tunes the ranking to return more.
 */
const JINTEL_BATCH_CAP = 20;

/**
 * Hop 0 — fetch the target's own relationships, subsidiaries, and concentration.
 * Returns the first entity in the batch response, or null if none / on error.
 */
export async function fetchSupplyChainHop0(client: JintelClient, ticker: string): Promise<Entity | null> {
  const result = await client.batchEnrich([ticker], ['subsidiaries', 'concentration', 'relationships'], {
    relationshipsFilter: { limit: 100, minConfidence: 0.3 },
  });

  if (!result.success) return null;
  const entity = result.data[0];
  return entity ?? null;
}

/**
 * Deterministic ranking — composite score weights structured USD value highest,
 * then disclosed share, then confidence, then a small type bias.
 *
 * - `CUSTOMER` edges bias up (+3) because customer concentration is the most
 *   informative downstream signal.
 * - `SUBSIDIARY` edges bias up (+2) because they often carry geography info.
 * - Everything else bias +1.
 *
 * Filters: only edges with a ticker OR CIK survive (we need an identifier to
 * fetch hop-1). Returns up to 8 unique tickers — CIK-only edges count toward
 * ranking but don't produce a batchEnrich target.
 */
export function rankCounterparties(edges: RelationshipEdge[]): string[] {
  const scored = edges
    .filter((edge) => edge.counterpartyTicker || edge.counterpartyCik)
    .map((edge) => ({
      edge,
      score: (edge.valueUsd ?? 0) * 1e-9 + (edge.sharePct ?? 0) * 10 + edge.confidence * 5 + typeBonus(edge.type),
    }))
    .sort((a, b) => b.score - a.score);

  const tickers = new Set<string>();
  for (const { edge } of scored) {
    if (edge.counterpartyTicker) {
      tickers.add(edge.counterpartyTicker);
      if (tickers.size >= 8) break;
    }
  }
  return [...tickers];
}

function typeBonus(type: RelationshipEdge['type']): number {
  if (type === 'CUSTOMER') return 3;
  if (type === 'SUBSIDIARY') return 2;
  return 1;
}

/**
 * Hop 1 — one batchEnrich over the ranked counterparty tickers. Returns the
 * list of entities Jintel resolved (may be shorter than input if some tickers
 * don't resolve). Returns an empty array on error or when `tickers` is empty.
 */
export async function fetchSupplyChainHop1(client: JintelClient, tickers: string[]): Promise<Entity[]> {
  if (tickers.length === 0) return [];
  // Defensive cap — `rankCounterparties` already returns <= 8, well under 20.
  const batch = tickers.slice(0, JINTEL_BATCH_CAP);
  const result = await client.batchEnrich(batch, ['subsidiaries', 'concentration', 'relationships'], {
    relationshipsFilter: {
      types: ['CUSTOMER', 'SUBSIDIARY', 'GOVERNMENT_CUSTOMER'],
      limit: 30,
      minConfidence: 0.3,
    },
  });
  if (!result.success) return [];
  return result.data;
}
