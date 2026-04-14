import PositionsListCard from './positions-list-card';
import PortfolioOverviewCard from './portfolio-overview-card';
import AllocationCard from './allocation-card';
import MorningBriefingCard from './morning-briefing-card';
import { StrategyProposalCard } from './strategy-proposal-card.js';

interface ToolRendererProps {
  tool: string;
  params: Record<string, unknown>;
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
    case 'positions-list': {
      const validVariants = ['top', 'worst', 'movers', 'all'] as const;
      const variant = validVariants.includes(params.variant as (typeof validVariants)[number])
        ? (params.variant as (typeof validVariants)[number])
        : 'all';
      card = <PositionsListCard variant={variant} />;
      break;
    }
    case 'portfolio-overview': {
      const validPeriods = ['today', 'week', 'ytd'] as const;
      const period = validPeriods.includes(params.period as (typeof validPeriods)[number])
        ? (params.period as (typeof validPeriods)[number])
        : 'today';
      card = <PortfolioOverviewCard period={period} />;
      break;
    }
    case 'allocation':
      card = <AllocationCard />;
      break;
    case 'morning-briefing':
      card = <MorningBriefingCard />;
      break;
    case 'propose-strategy':
      card = (
        <StrategyProposalCard
          name={params.name as string | undefined}
          category={params.category as string | undefined}
          triggerCount={
            Array.isArray(params.triggerGroups)
              ? (params.triggerGroups as { conditions?: unknown[] }[]).reduce(
                  (sum, g) => sum + (Array.isArray(g.conditions) ? g.conditions.length : 0),
                  0,
                )
              : undefined
          }
        />
      );
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
