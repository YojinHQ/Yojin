import { describe, it, expect } from 'vitest';

import type { SupplyChainExpansion } from '../api/types';
import { edgeKey, mergeExpansionIntoGraph, type GraphData } from './supply-chain-merge';

function expansion(partial: Partial<SupplyChainExpansion> = {}): SupplyChainExpansion {
  return {
    sourceNodeId: 'ticker:AAPL',
    direction: 'UPSTREAM_SUPPLIERS',
    requestedTicker: 'AAPL',
    nodes: [],
    edges: [],
    reasoning: null,
    expandedAt: '2026-04-22T00:00:00.000Z',
    staleAfter: '2026-04-23T00:00:00.000Z',
    synthesizedBy: null,
    ...partial,
  };
}

describe('edgeKey', () => {
  it('composes a stable key from sourceId, targetId, and relationship', () => {
    expect(edgeKey({ sourceId: 'a', targetId: 'b', relationship: 'SUPPLIER' })).toBe('a->b|SUPPLIER');
  });

  it('distinguishes different relationships between the same pair', () => {
    const k1 = edgeKey({ sourceId: 'a', targetId: 'b', relationship: 'SUPPLIER' });
    const k2 = edgeKey({ sourceId: 'a', targetId: 'b', relationship: 'DISTRIBUTOR' });
    expect(k1).not.toBe(k2);
  });
});

describe('mergeExpansionIntoGraph', () => {
  const current: GraphData = {
    nodes: [
      {
        id: 'ticker:AAPL',
        label: 'Apple',
        ticker: 'AAPL',
        cik: null,
        nodeKind: 'COUNTERPARTY',
        countryCode: null,
        rank: 0,
        x: 123.4,
        y: -56.7,
      },
    ],
    edges: [],
  };

  it('preserves existing node x/y when an incoming node collides on id', () => {
    const merged = mergeExpansionIntoGraph(
      current,
      expansion({
        nodes: [
          {
            id: 'ticker:AAPL',
            label: 'Apple Inc.',
            ticker: 'AAPL',
            cik: '0000320193',
            nodeKind: 'COUNTERPARTY',
            countryCode: 'US',
            rank: 5,
          },
        ],
      }),
    );

    const apple = merged.nodes.find((n) => n.id === 'ticker:AAPL');
    expect(apple).toBeDefined();
    expect(apple?.x).toBe(123.4);
    expect(apple?.y).toBe(-56.7);
    // Label and metadata updates DO apply.
    expect(apple?.label).toBe('Apple Inc.');
    expect(apple?.cik).toBe('0000320193');
    expect(apple?.countryCode).toBe('US');
    expect(apple?.rank).toBe(5);
  });

  it('appends new nodes and edges', () => {
    const merged = mergeExpansionIntoGraph(
      current,
      expansion({
        nodes: [
          {
            id: 'ticker:TSM',
            label: 'TSMC',
            ticker: 'TSM',
            cik: null,
            nodeKind: 'COUNTERPARTY',
            countryCode: 'TW',
            rank: 1,
          },
        ],
        edges: [
          {
            sourceId: 'ticker:AAPL',
            targetId: 'ticker:TSM',
            relationship: 'MANUFACTURER',
            label: 'contract foundry',
            edgeOrigin: 'JINTEL_DIRECT',
            criticality: 0.9,
            evidence: [],
          },
        ],
      }),
    );

    expect(merged.nodes.map((n) => n.id).sort()).toEqual(['ticker:AAPL', 'ticker:TSM']);
    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0]).toMatchObject({
      sourceId: 'ticker:AAPL',
      targetId: 'ticker:TSM',
      relationship: 'MANUFACTURER',
    });
  });

  it('dedupes edges by (sourceId, targetId, relationship) — re-running the same chip is idempotent', () => {
    const withEdge: GraphData = {
      nodes: current.nodes,
      edges: [
        {
          sourceId: 'ticker:AAPL',
          targetId: 'ticker:TSM',
          relationship: 'MANUFACTURER',
          label: 'old label',
          edgeOrigin: 'JINTEL_DIRECT',
          criticality: 0.5,
          evidence: [],
        },
      ],
    };

    const merged = mergeExpansionIntoGraph(
      withEdge,
      expansion({
        edges: [
          {
            sourceId: 'ticker:AAPL',
            targetId: 'ticker:TSM',
            relationship: 'MANUFACTURER',
            label: 'contract foundry', // incoming label/criticality WIN.
            edgeOrigin: 'LLM_INFERRED',
            criticality: 0.95,
            evidence: [],
          },
        ],
      }),
    );

    expect(merged.edges).toHaveLength(1);
    expect(merged.edges[0]).toMatchObject({
      label: 'contract foundry',
      edgeOrigin: 'LLM_INFERRED',
      criticality: 0.95,
    });
  });

  it('keeps parallel edges between the same pair under different relationships', () => {
    const merged = mergeExpansionIntoGraph(
      current,
      expansion({
        edges: [
          {
            sourceId: 'ticker:AAPL',
            targetId: 'ticker:TSM',
            relationship: 'MANUFACTURER',
            label: 'foundry',
            edgeOrigin: 'JINTEL_DIRECT',
            criticality: 0.9,
            evidence: [],
          },
          {
            sourceId: 'ticker:AAPL',
            targetId: 'ticker:TSM',
            relationship: 'PARTNER',
            label: 'R&D partner',
            edgeOrigin: 'LLM_INFERRED',
            criticality: 0.3,
            evidence: [],
          },
        ],
      }),
    );

    expect(merged.edges).toHaveLength(2);
  });
});
