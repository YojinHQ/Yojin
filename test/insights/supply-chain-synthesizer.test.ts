import { describe, expect, it, vi } from 'vitest';

import type { ProviderRouter } from '../../src/ai-providers/router.js';
import { synthesizeSupplyChainMap } from '../../src/insights/supply-chain-synthesizer.js';
import type { SupplyChainMap } from '../../src/insights/supply-chain-types.js';

function makeRawMap(): SupplyChainMap {
  const now = new Date().toISOString();
  return {
    ticker: 'AAPL',
    entityName: 'Apple Inc.',
    upstream: [
      {
        counterpartyName: 'Taiwan Semiconductor',
        counterpartyTicker: 'TSM',
        counterpartyCik: null,
        relationship: 'MANUFACTURER',
        edgeOrigin: 'JINTEL_DIRECT',
        criticality: 0.9,
        substitutability: null,
        evidence: [{ connector: 'sec-segments', url: null, ref: 'ref-1', asOf: '2024-11-01', contextQuote: null }],
        originCountry: null,
      },
      {
        counterpartyName: 'Samsung Electronics',
        counterpartyTicker: null,
        counterpartyCik: null,
        relationship: 'PARTNER',
        edgeOrigin: 'JINTEL_DIRECT',
        criticality: 0.5,
        substitutability: null,
        evidence: [{ connector: 'sec-exhibit21', url: null, ref: 'ref-2', asOf: '2024-11-01', contextQuote: null }],
        originCountry: null,
      },
    ],
    downstream: [],
    geographicFootprint: [{ iso2: 'TW', country: 'Taiwan', criticality: 1, entities: ['TSMC'] }],
    concentrationRisks: [{ dimension: 'GEOGRAPHY', hhi: 3500, label: 'Top-3 geography = 91% (HHI 3500)' }],
    narrative: null,
    asOf: now,
    dataAsOf: '2024-11-01',
    staleAfter: new Date(Date.parse(now) + 86_400_000).toISOString(),
    sources: [{ connector: 'sec-segments', asOf: '2024-11-01', ref: 'ref-1' }],
    synthesizedBy: null,
  };
}

function makeRouter(textResponse: string): ProviderRouter {
  const completeWithTools = vi.fn().mockResolvedValue({
    content: [{ type: 'text' as const, text: textResponse }],
    stopReason: 'end_turn',
    usage: { inputTokens: 100, outputTokens: 50 },
  });
  const resolve = vi.fn().mockReturnValue({ provider: { id: 'claude-code' }, model: 'claude-sonnet-4-6' });
  return { completeWithTools, resolve } as unknown as ProviderRouter;
}

describe('synthesizeSupplyChainMap', () => {
  it('merges narrative + per-edge enrichments onto raw map (JSON response)', async () => {
    const llmJson = JSON.stringify({
      narrative: 'Apple is structurally dependent on TSMC for leading-edge SoCs.',
      upstreamEnrichments: [
        { matchKey: 'TSM', substitutability: 'LOW', originCountry: 'TW' },
        { matchKey: 'Samsung Electronics', substitutability: 'MEDIUM', originCountry: 'KR' },
      ],
    });
    const router = makeRouter(llmJson);

    const out = await synthesizeSupplyChainMap({
      providerRouter: router,
      rawMap: makeRawMap(),
      hop0: {},
      hop1: [],
    });

    expect(out.narrative).toContain('TSMC');
    expect(out.synthesizedBy).toEqual({ provider: 'claude-code', model: 'claude-sonnet-4-6' });
    const tsm = out.upstream.find((e) => e.counterpartyTicker === 'TSM');
    expect(tsm?.substitutability).toBe('LOW');
    expect(tsm?.originCountry).toBe('TW');
    const samsung = out.upstream.find((e) => e.counterpartyName === 'Samsung Electronics');
    expect(samsung?.substitutability).toBe('MEDIUM');
    expect(samsung?.originCountry).toBe('KR');
  });

  it('enables prompt caching on the system prefix', async () => {
    const llmJson = JSON.stringify({ narrative: 'x', upstreamEnrichments: [] });
    const router = makeRouter(llmJson);
    // narrative must pass .min(1) so use "x"; this test only verifies the cacheSystem flag.

    await synthesizeSupplyChainMap({
      providerRouter: router,
      rawMap: makeRawMap(),
      hop0: {},
      hop1: [],
    });

    const call = (router.completeWithTools as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.cacheSystem).toBe(true);
    expect(call.model).toBe('sonnet');
  });

  it('preserves edges, concentration, sources, and dataAsOf unchanged from raw map', async () => {
    const raw = makeRawMap();
    const router = makeRouter(
      JSON.stringify({
        narrative: 'short narrative',
        upstreamEnrichments: [],
      }),
    );

    const out = await synthesizeSupplyChainMap({ providerRouter: router, rawMap: raw, hop0: {}, hop1: [] });

    expect(out.upstream).toHaveLength(raw.upstream.length);
    expect(out.upstream.map((e) => e.criticality)).toEqual(raw.upstream.map((e) => e.criticality));
    expect(out.concentrationRisks).toEqual(raw.concentrationRisks);
    expect(out.sources).toEqual(raw.sources);
    expect(out.dataAsOf).toBe(raw.dataAsOf);
    expect(out.ticker).toBe(raw.ticker);
  });

  it('drops LLM enrichments whose matchKey does not exist in the raw map', async () => {
    const llmJson = JSON.stringify({
      narrative: 'x',
      upstreamEnrichments: [{ matchKey: 'NVDA', substitutability: 'LOW', originCountry: 'US' }],
    });
    const router = makeRouter(llmJson);

    const out = await synthesizeSupplyChainMap({
      providerRouter: router,
      rawMap: makeRawMap(),
      hop0: {},
      hop1: [],
    });

    // No upstream edge should have been annotated — NVDA isn't in the raw map.
    expect(out.upstream.every((e) => e.substitutability === null)).toBe(true);
    expect(out.upstream.every((e) => e.originCountry === null)).toBe(true);
  });

  it('tolerates JSON wrapped in prose / markdown fences', async () => {
    const wrapped = `Here you go:\n\n\`\`\`json\n${JSON.stringify({
      narrative: 'Apple ~ TSMC dependence.',
      upstreamEnrichments: [{ matchKey: 'TSM', substitutability: 'LOW', originCountry: 'TW' }],
    })}\n\`\`\``;
    const router = makeRouter(wrapped);

    const out = await synthesizeSupplyChainMap({
      providerRouter: router,
      rawMap: makeRawMap(),
      hop0: {},
      hop1: [],
    });
    expect(out.narrative).toContain('TSMC');
  });

  it('throws on empty response (caller falls back to raw map)', async () => {
    const router = makeRouter('');

    await expect(
      synthesizeSupplyChainMap({ providerRouter: router, rawMap: makeRawMap(), hop0: {}, hop1: [] }),
    ).rejects.toThrow(/empty response/);
  });

  it('throws on malformed JSON', async () => {
    const router = makeRouter('this is not json and has no braces');

    await expect(
      synthesizeSupplyChainMap({ providerRouter: router, rawMap: makeRawMap(), hop0: {}, hop1: [] }),
    ).rejects.toThrow(/no JSON object/);
  });

  it('throws on schema violation (missing narrative)', async () => {
    const router = makeRouter(JSON.stringify({ upstreamEnrichments: [] }));

    await expect(
      synthesizeSupplyChainMap({ providerRouter: router, rawMap: makeRawMap(), hop0: {}, hop1: [] }),
    ).rejects.toThrow();
  });
});
