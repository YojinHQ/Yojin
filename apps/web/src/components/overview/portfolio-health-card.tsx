import { cn } from '../../lib/utils';
import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';
import { DashboardCard } from '../common/dashboard-card';
import type { InsightReport, PortfolioHealth } from '../../api/types';

const healthVariant: Record<PortfolioHealth, BadgeVariant> = {
  STRONG: 'success',
  HEALTHY: 'success',
  CAUTIOUS: 'warning',
  WEAK: 'error',
  CRITICAL: 'error',
};

function ConfidenceBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.round(value * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs text-text-secondary">{label}</span>
        <span className="text-xs font-semibold text-text-primary">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-tertiary">
        <div
          className={cn(
            'h-1.5 rounded-full transition-all',
            pct >= 70 ? 'bg-success' : pct >= 40 ? 'bg-warning' : 'bg-error',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function PortfolioHealthCard({ report }: { report: InsightReport }) {
  return (
    <DashboardCard title="Portfolio Health">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
        {/* Health status + summary */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant={healthVariant[report.portfolio.overallHealth]} size="sm">
              {report.portfolio.overallHealth}
            </Badge>
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">{report.portfolio.summary}</p>
        </div>

        {/* Agent confidence meters */}
        <div className="space-y-2">
          <ConfidenceBar label="Confidence" value={report.emotionState.confidence} />
          <ConfidenceBar label="Risk Appetite" value={report.emotionState.riskAppetite} />
        </div>
      </div>
    </DashboardCard>
  );
}
