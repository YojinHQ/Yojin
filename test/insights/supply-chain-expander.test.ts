import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Entity, JintelClient, JintelResult } from '@yojinhq/jintel-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderRouter } from '../../src/ai-providers/router.js';
import { expandSupplyChainNode } from '../../src/insights/supply-chain-expander.js';
import { SupplyChainExpansionStore, expansionCacheKey } from '../../src/insights/supply-chain-expansion-store.js';
import type { SupplyChainExpansion } from '../../src/insights/supply-chain-types.js';

/**
 * Tiny entity stub — just enough of Jintel's `Entity` shape to drive the two
 * branches we care about (UPSTREAM_SUPPLIERS + COUNTRY_EXPOSURE). We cast to
 * the full Entity at the boundary; extra fields default to undefined.
 */
function makeEntity(): Entity {
  return {
    name: 'Apple Inc.',
    ticker: 'AAPL',
    cik: '0000320193',
    assetClass: 'EQUITY',
    relationships: [
      {
        type: 'PARTNER',
        direction: 'IN',
        counterpartyName: 'Taiwan Semiconductor',
        counterpartyTicker: 'TSM',
        counterpartyCik: null,
        confidence: 0.9,
        context: 'primary foundry',
        source: { connector: 'sec-10k', asOf: '2024-11-01', ref: 'TSM-PARTNER-1', url: null },
      },
      {
        type: 'OWNERSHIP',
        direction: 'IN',
        counterpartyName: 'Berkshire Hathaway',
        counterpartyTicker: 'BRK.B',
        counterpartyCik: null,
        confidence: 0.95,
        context: 'largest shareholder',
        source: { connector: 'sec-13f', asOf: '2024-09-30', ref: 'BRK-13F-1', url: null },
      },
    ],
    subsidiaries: { subsidiaries: [], asOf: '2024-11-01', sources: [] },
    concentration: null,
  } as unknown as Entity;
}

function makeJintelClient(entity: Entity | null): JintelClient {
  const result: JintelResult<Entity[]> = entity
    ? { success: true, data: [entity] }
    : { success: false, error: 'no entity' };
  return {
    batchEnrich: vi.fn().mockResolvedValue(result),
  } as unknown as JintelClient;
}

function makeRouter(jsonPayload: string): ProviderRouter {
  return {
    completeWithTools: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: jsonPayload }],
      stopReason: 'end_turn',
    }),
  } as unknown as ProviderRouter;
}

describe('expandSupplyChainNode', () => {
  let dataRoot: string;
  let store: SupplyChainExpansionStore;

  beforeEach(() => {
    dataRoot = mkdtempSync(join(tmpdir(), 'supply-chain-expander-'));
    store = new SupplyChainExpansionStore(dataRoot);
  });

  afterEach(() => {
    rmSync(dataRoot, { recursive: true, force: true });
  });

  it('cache round-trip: second call returns cached expansion without re-running Jintel or the LLM', async () => {
    const entity = makeEntity();
    const jintelClient = makeJintelClient(entity);
    const router = makeRouter(
      JSON.stringify({
        reasoning: 'TSM is the primary foundry for Apple silicon.',
        ranked: [
          {
            id: 'ticker:TSM',
            label: 'Taiwan Semiconductor',
            edgeLabel: 'primary foundry',
            criticality: 0.92,
            relationship: 'MANUFACTURER',
          },
        ],
      }),
    );

    const first = await expandSupplyChainNode(
      { sourceNodeId: 'ticker:AAPL', direction: 'UPSTREAM_SUPPLIERS', requestedTicker: 'AAPL' },
      { jintelClient, providerRouter: router, store },
    );

    expect(first).not.toBeNull();
    expect(first?.nodes).toHaveLength(1);
    expect(first?.nodes[0].id).toBe('ticker:TSM');
    expect(first?.edges[0].relationship).toBe('MANUFACTURER');
    expect(first?.synthesizedBy).toEqual({ provider: 'claude-code', model: 'claude-opus-4-7' });

    // Store now has the entry.
    const key = expansionCacheKey({
      sourceNodeId: 'ticker:AAPL',
      direction: 'UPSTREAM_SUPPLIERS',
      hopDepth: 1,
    });
    expect(await store.exists(key)).toBe(true);

    // Second call — should short-circuit on cache.
    const second = await expandSupplyChainNode(
      { sourceNodeId: 'ticker:AAPL', direction: 'UPSTREAM_SUPPLIERS', requestedTicker: 'AAPL' },
      { jintelClient, providerRouter: router, store },
    );

    expect(second).not.toBeNull();
    expect(second?.expandedAt).toBe(first?.expandedAt); // same persisted record
    expect(jintelClient.batchEnrich).toHaveBeenCalledTimes(1);
    expect(router.completeWithTools).toHaveBeenCalledTimes(1);
  });

  it('drops LLM-emitted ids that were not in the deterministic candidate pool (anti-hallucination)', async () => {
    const entity = makeEntity();
    const jintelClient = makeJintelClient(entity);
    // LLM returns two ranked items: one real (ticker:TSM was in the candidate
    // pool via the PARTNER/IN relationship), one fabricated (ticker:GHOST).
    const router = makeRouter(
      JSON.stringify({
        reasoning: 'Ranking suppliers.',
        ranked: [
          {
            id: 'ticker:TSM',
            label: 'Taiwan Semiconductor',
            edgeLabel: 'primary foundry',
            criticality: 0.9,
            relationship: 'MANUFACTURER',
          },
          {
            id: 'ticker:GHOST',
            label: 'Hallucinated Supplier',
            edgeLabel: 'invented tier-1',
            criticality: 0.8,
            relationship: 'SUPPLIER',
          },
        ],
      }),
    );

    const expansion = (await expandSupplyChainNode(
      { sourceNodeId: 'ticker:AAPL', direction: 'UPSTREAM_SUPPLIERS', requestedTicker: 'AAPL' },
      { jintelClient, providerRouter: router, store },
    )) as SupplyChainExpansion;

    expect(expansion).not.toBeNull();
    // Only the supportable candidate survives; GHOST is silently dropped.
    expect(expansion.nodes.map((n) => n.id)).toEqual(['ticker:TSM']);
    expect(expansion.edges.map((e) => e.targetId)).toEqual(['ticker:TSM']);
    // Evidence is sourced from Jintel, not the LLM.
    expect(expansion.edges[0].evidence[0].connector).toBe('sec-10k');
  });

  it('returns an empty expansion (not null) when Jintel has no candidates for the direction', async () => {
    // Use DOWNSTREAM_CUSTOMERS — the stub entity has no CUSTOMER edges, so the
    // candidate pool is empty and the LLM is never called.
    const entity = makeEntity();
    const jintelClient = makeJintelClient(entity);
    const router = makeRouter('{}'); // would fail schema if called

    const expansion = await expandSupplyChainNode(
      { sourceNodeId: 'ticker:AAPL', direction: 'DOWNSTREAM_CUSTOMERS', requestedTicker: 'AAPL' },
      { jintelClient, providerRouter: router, store },
    );

    expect(expansion).not.toBeNull();
    expect(expansion?.nodes).toEqual([]);
    expect(expansion?.edges).toEqual([]);
    expect(expansion?.synthesizedBy).toBeNull();
    expect(router.completeWithTools).not.toHaveBeenCalled();
  });

  it('returns null when no Jintel client is wired (feature unavailable)', async () => {
    const router = makeRouter('{}');
    const expansion = await expandSupplyChainNode(
      { sourceNodeId: 'ticker:AAPL', direction: 'UPSTREAM_SUPPLIERS', requestedTicker: 'AAPL' },
      { jintelClient: undefined, providerRouter: router, store },
    );
    expect(expansion).toBeNull();
  });
});
