import { useMemo, useState } from 'react';
import { useQuery } from 'urql';

import { SUPPLY_CHAIN_GRAPH_QUERY } from '../api/documents';
import { usePortfolio } from '../api/hooks/use-portfolio';
import type { SupplyChainGraphQueryResult } from '../api/types';
import { PageBlurGate } from '../components/common/page-blur-gate';
import { SupplyChainGraph } from '../components/supply-chain/supply-chain-graph';
import { SupplyChainSummaryPanel } from '../components/supply-chain/supply-chain-summary-panel';
import { substitutabilityColor } from '../lib/supply-chain-graph';

export default function SupplyChainPage() {
  return (
    <PageBlurGate requires="jintel" mockContent={<MockSupplyChain />}>
      <SupplyChainContent />
    </PageBlurGate>
  );
}

function SupplyChainContent() {
  const [portfolioResult] = usePortfolio();
  const tickers = useMemo(() => {
    const positions = portfolioResult.data?.portfolio?.positions ?? [];
    return [...new Set(positions.map((p) => p.symbol.toUpperCase()))];
  }, [portfolioResult.data]);

  const [result] = useQuery<SupplyChainGraphQueryResult, { tickers: string[] }>({
    query: SUPPLY_CHAIN_GRAPH_QUERY,
    variables: { tickers },
    pause: tickers.length === 0,
    requestPolicy: 'cache-and-network',
  });

  const [bottlenecksOnly, setBottlenecksOnly] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const maps = result.data?.supplyChainMapsByTickers ?? [];
  const summary = result.data?.portfolioSupplyChainSummary ?? {
    topCountryExposures: [],
    sharedCounterparties: [],
    singlePointsOfFailure: [],
    concentrationStack: [],
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-headline text-xl font-semibold text-text-primary">Supply-chain graph</h1>
          <p className="text-sm text-text-muted">
            Portfolio tickers and the counterparties they depend on. Hover an edge to see substitutability; click a hub
            to see which positions feed into it.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-secondary">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={bottlenecksOnly}
            onChange={(e) => setBottlenecksOnly(e.target.checked)}
          />
          Bottlenecks only
        </label>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="flex min-h-[420px] flex-col overflow-hidden rounded-lg border border-border bg-bg-card">
          <div className="flex flex-shrink-0 items-center gap-4 border-b border-border px-4 py-2 text-xs text-text-muted">
            <Legend color={substitutabilityColor('LOW')} label="LOW subst (bottleneck)" />
            <Legend color={substitutabilityColor('MEDIUM')} label="MEDIUM" />
            <Legend color={substitutabilityColor('HIGH')} label="HIGH (resilient)" />
            <Legend color={substitutabilityColor(null)} label="Unknown" />
            <span className="ml-auto">
              {result.fetching
                ? 'Loading…'
                : maps.length > 0
                  ? `${maps.length} maps · ${tickers.length} tickers`
                  : 'No maps cached yet — run a digest to populate.'}
            </span>
          </div>
          <div className="relative min-h-0 flex-1">
            {result.error ? (
              <div className="flex h-full items-center justify-center text-sm text-error">
                Failed to load supply-chain graph.
              </div>
            ) : tickers.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-text-muted">
                Add positions to your portfolio to see the graph.
              </div>
            ) : (
              <SupplyChainGraph
                maps={maps}
                portfolioTickers={tickers}
                bottlenecksOnly={bottlenecksOnly}
                focusedNodeId={focusedId}
                onNodeClick={(n) => setFocusedId(n.id)}
              />
            )}
          </div>
        </div>

        <aside className="min-h-[420px] overflow-hidden rounded-lg border border-border bg-bg-card">
          <SupplyChainSummaryPanel
            summary={summary}
            onTickerClick={(t) => setFocusedId(t.toUpperCase())}
            onCounterpartyClick={(id) => setFocusedId(id.toUpperCase())}
          />
        </aside>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function MockSupplyChain() {
  // Static placeholder that hints at the eventual shape. Deliberately plain —
  // the blur gate only needs suggestive structure, not a real graph.
  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="h-6 w-48 rounded-md bg-bg-tertiary" />
      <div className="grid flex-1 grid-cols-[2fr_1fr] gap-4">
        <div className="rounded-lg border border-border bg-bg-card" />
        <div className="rounded-lg border border-border bg-bg-card" />
      </div>
    </div>
  );
}
