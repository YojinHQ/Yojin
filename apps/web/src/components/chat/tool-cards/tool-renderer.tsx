import PositionsListCard from './positions-list-card';
import PortfolioOverviewCard from './portfolio-overview-card';
import AllocationCard from './allocation-card';

interface ToolRendererProps {
  tool: string;
  params: Record<string, string>;
}

/**
 * Maps tool action names to rich React components.
 *
 * Tool actions follow the pattern: `tool:<name>` or `tool:<name>:<param>`.
 * The renderer receives the parsed name and params.
 */
export default function ToolRenderer({ tool, params }: ToolRendererProps) {
  switch (tool) {
    case 'positions-list':
      return <PositionsListCard variant={(params.variant as 'top' | 'worst' | 'movers' | 'all') ?? 'all'} />;

    case 'portfolio-overview':
      return <PortfolioOverviewCard period={(params.period as 'today' | 'week' | 'ytd') ?? 'today'} />;

    case 'allocation':
      return <AllocationCard />;

    default:
      return (
        <div className="rounded-xl border border-border bg-bg-card px-6 py-4">
          <p className="text-sm text-text-muted">Unknown tool: {tool}</p>
        </div>
      );
  }
}
