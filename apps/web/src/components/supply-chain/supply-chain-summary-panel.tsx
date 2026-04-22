import type { PortfolioSupplyChainSummary } from '../../api/types';

interface SupplyChainSummaryPanelProps {
  summary: PortfolioSupplyChainSummary;
  onTickerClick?: (ticker: string) => void;
  onCounterpartyClick?: (id: string) => void;
}

/**
 * Text-side of the graph: the four aggregation rollups that graphcache
 * already stores via `portfolioSupplyChainSummary`. Keeps the component
 * presentational — all IDs resolve back to the force-graph via callbacks.
 */
export function SupplyChainSummaryPanel({ summary, onTickerClick, onCounterpartyClick }: SupplyChainSummaryPanelProps) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm">
      <Section title="Single points of failure" empty={summary.singlePointsOfFailure.length === 0}>
        {summary.singlePointsOfFailure.map((spof, i) => (
          <Row
            key={`${spof.ticker}:${spof.counterpartyName}:${i}`}
            onClick={() => onCounterpartyClick?.(spof.counterpartyName)}
            left={
              <div>
                <span className="font-medium text-text-primary">{spof.counterpartyName}</span>
                <span className="ml-2 text-text-muted">via {spof.ticker}</span>
              </div>
            }
            right={<span className="text-2xs uppercase tracking-wider text-error">Bottleneck</span>}
            caption={spof.reason}
          />
        ))}
      </Section>

      <Section title="Shared counterparties" empty={summary.sharedCounterparties.length === 0}>
        {summary.sharedCounterparties.map((cp) => (
          <Row
            key={`${cp.counterpartyTicker ?? cp.counterpartyName}`}
            onClick={() => onCounterpartyClick?.(cp.counterpartyTicker ?? cp.counterpartyName)}
            left={
              <div>
                <span className="font-medium text-text-primary">{cp.counterpartyName}</span>
                {cp.counterpartyTicker && (
                  <span className="ml-2 text-2xs text-text-muted">{cp.counterpartyTicker}</span>
                )}
              </div>
            }
            right={<span className="text-2xs text-text-muted">{cp.count} tickers</span>}
            caption={cp.tickers.join(' · ')}
          />
        ))}
      </Section>

      <Section title="Country exposure" empty={summary.topCountryExposures.length === 0}>
        {summary.topCountryExposures.map((c) => (
          <Row
            key={c.iso2}
            left={
              <div>
                <span className="font-medium text-text-primary">{c.country}</span>
                <span className="ml-2 text-2xs text-text-muted">{c.iso2}</span>
              </div>
            }
            right={<span className="text-2xs text-text-muted">weight {c.criticalityWeightedCount.toFixed(2)}</span>}
            caption={c.tickers.join(' · ')}
          />
        ))}
      </Section>

      <Section title="Concentration stack" empty={summary.concentrationStack.length === 0}>
        {summary.concentrationStack.map((c, i) => (
          <Row
            key={`${c.ticker}:${i}`}
            onClick={() => onTickerClick?.(c.ticker)}
            left={
              <div>
                <span className="font-medium text-text-primary">{c.ticker}</span>
                <span className="ml-2 text-2xs text-text-muted">{c.flag.dimension}</span>
              </div>
            }
            right={<span className="text-2xs text-text-muted">HHI {Math.round(c.flag.hhi)}</span>}
            caption={c.flag.label}
          />
        ))}
      </Section>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-2xs font-medium uppercase tracking-wider text-text-muted">{title}</h3>
      {empty ? (
        <p className="text-xs text-text-muted">Nothing flagged yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">{children}</ul>
      )}
    </section>
  );
}

function Row({
  left,
  right,
  caption,
  onClick,
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  caption?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <li>
      <Tag
        type={onClick ? 'button' : undefined}
        onClick={onClick}
        className={
          'flex w-full flex-col gap-0.5 rounded-md border border-border bg-bg-secondary px-3 py-2 text-left transition-colors' +
          (onClick ? ' hover:border-accent-primary/40' : '')
        }
      >
        <div className="flex items-center justify-between gap-3">
          {left}
          {right}
        </div>
        {caption && <span className="truncate text-2xs text-text-muted">{caption}</span>}
      </Tag>
    </li>
  );
}
