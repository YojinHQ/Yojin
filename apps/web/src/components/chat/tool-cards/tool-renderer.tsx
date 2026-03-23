import PositionsListCard from './positions-list-card';
import PortfolioOverviewCard from './portfolio-overview-card';
import AllocationCard from './allocation-card';
import MorningBriefingCard from './morning-briefing-card';

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
  let card: React.ReactNode;

  switch (tool) {
    case 'positions-list':
      card = <PositionsListCard variant={(params.variant as 'top' | 'worst' | 'movers' | 'all') ?? 'all'} />;
      break;
    case 'portfolio-overview':
      card = <PortfolioOverviewCard period={(params.period as 'today' | 'week' | 'ytd') ?? 'today'} />;
      break;
    case 'allocation':
      card = <AllocationCard />;
      break;
    case 'morning-briefing':
      card = <MorningBriefingCard />;
      break;
    default:
      return (
        <div className="rounded-xl border border-border bg-bg-card px-6 py-4">
          <p className="text-sm text-text-muted">Unknown tool: {tool}</p>
        </div>
      );
  }

  return <div className="animate-card-in">{card}</div>;
}
