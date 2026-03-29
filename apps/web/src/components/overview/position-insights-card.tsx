import { Link, useNavigate } from 'react-router';
import { cn } from '../../lib/utils';
import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';
import { DashboardCard } from '../common/dashboard-card';
import { SymbolLogo } from '../common/symbol-logo';
import type { PositionInsight, InsightRating, Position } from '../../api/types';

const ratingVariant: Record<InsightRating, BadgeVariant> = {
  VERY_BULLISH: 'success',
  BULLISH: 'success',
  NEUTRAL: 'warning',
  BEARISH: 'error',
  VERY_BEARISH: 'error',
};

const ratingLabel: Record<InsightRating, string> = {
  VERY_BULLISH: 'Very Bullish',
  BULLISH: 'Bullish',
  NEUTRAL: 'Neutral',
  BEARISH: 'Bearish',
  VERY_BEARISH: 'Very Bearish',
};

export function PositionInsightsCard({ insights, positions }: { insights: PositionInsight[]; positions: Position[] }) {
  const navigate = useNavigate();

  if (insights.length === 0) return null;

  const viewAllLink = (
    <Link to="/insights" className="text-2xs text-accent-primary transition-colors hover:text-accent-primary/80">
      View All
    </Link>
  );

  return (
    <DashboardCard title="Position Insights" headerAction={viewAllLink}>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-0.5 px-4 pb-4">
          {insights.map((insight) => {
            const pos = positions.find((p) => p.symbol === insight.symbol);
            const pct = Math.round(insight.conviction * 100);
            return (
              <div
                key={insight.symbol}
                className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-bg-hover cursor-pointer"
                onClick={() => navigate(`/portfolio/${insight.symbol.toLowerCase()}`)}
              >
                <SymbolLogo
                  symbol={insight.symbol}
                  assetClass={(pos?.assetClass?.toLowerCase() ?? 'equity') as 'equity' | 'crypto'}
                  size="sm"
                />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="text-xs font-semibold text-text-primary">{insight.symbol}</span>
                  <Badge variant={ratingVariant[insight.rating]} size="xs">
                    {ratingLabel[insight.rating]}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-2xs text-text-muted">Conviction</span>
                  <span
                    className={cn(
                      'text-xs font-semibold tabular-nums',
                      pct >= 70 ? 'text-success' : pct >= 40 ? 'text-warning' : 'text-error',
                    )}
                  >
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardCard>
  );
}
