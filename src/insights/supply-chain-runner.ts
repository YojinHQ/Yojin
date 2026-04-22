/**
 * `ensureSupplyChainMap` — Phase A orchestrator.
 *
 * Cache hit → return stored map. Cache miss → hop-0, rank, hop-1, build, put.
 * Degraded upstream (empty edges + empty concentration + empty subsidiaries)
 * is NOT cached — serve the stale stored map (or null) instead. Any thrown
 * error is caught, logged as a warning, and falls back to the stored map.
 *
 * No Jintel client → return null (not an error; the feature just isn't
 * available in this environment).
 */

import type { JintelClient } from '@yojinhq/jintel-client';

import { fetchSupplyChainHop0, fetchSupplyChainHop1, rankCounterparties } from './supply-chain-jintel.js';
import { buildRawSupplyChainMap } from './supply-chain-raw-builder.js';
import type { SupplyChainStore } from './supply-chain-store.js';
import type { SupplyChainMap } from './supply-chain-types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('supply-chain-runner');

export interface EnsureSupplyChainMapArgs {
  ticker: string;
  entityName?: string;
  jintelClient?: JintelClient | undefined;
  store: SupplyChainStore;
  maxAgeMs: number;
}

export async function ensureSupplyChainMap(args: EnsureSupplyChainMapArgs): Promise<SupplyChainMap | null> {
  const { ticker, jintelClient, store, maxAgeMs } = args;

  if (!jintelClient) {
    // Feature unavailable without a client — silent null, not an error.
    return null;
  }

  if (await store.isFresh(ticker, maxAgeMs)) {
    return store.get(ticker);
  }

  try {
    const hop0 = await fetchSupplyChainHop0(jintelClient, ticker);
    if (!hop0) {
      logger.warn('Hop-0 fetch returned no entity — serving stale', { ticker });
      return store.get(ticker);
    }

    const relationships = hop0.relationships ?? [];
    const topCounterparties = rankCounterparties(relationships);
    const hop1 = topCounterparties.length ? await fetchSupplyChainHop1(jintelClient, topCounterparties) : [];

    const map = buildRawSupplyChainMap(ticker, hop0, hop1);

    if (isDegraded(map, hop0)) {
      logger.warn('Degraded Jintel response (no edges / concentration / subsidiaries) — not caching', {
        ticker,
      });
      return store.get(ticker);
    }

    await store.put(map);
    return map;
  } catch (err) {
    logger.warn('Supply-chain build failed — serving stale', { ticker, error: String(err) });
    return store.get(ticker);
  }
}

/**
 * A map is "degraded" when Jintel returned HTTP-200 but no usable data:
 * zero edges, no concentration breakdowns, and no subsidiaries. Caching that
 * would pin a useless map for 24h; fall back to the stored (possibly stale)
 * version instead.
 */
function isDegraded(
  map: SupplyChainMap,
  hop0: { concentration?: unknown; subsidiaries?: { subsidiaries?: unknown[] } | null },
): boolean {
  if (map.upstream.length > 0 || map.downstream.length > 0) return false;

  const concentration = hop0.concentration as
    | { product?: unknown; segment?: unknown; geography?: unknown; customer?: unknown }
    | null
    | undefined;
  const hasConcentration =
    !!concentration &&
    (!!concentration.product || !!concentration.segment || !!concentration.geography || !!concentration.customer);
  if (hasConcentration) return false;

  const subs = hop0.subsidiaries?.subsidiaries ?? [];
  if (Array.isArray(subs) && subs.length > 0) return false;

  return true;
}
