import { DashboardCard } from '../common/dashboard-card';
import type { PortfolioInsight } from '../../api/types';

export function MacroContextCard({ portfolio }: { portfolio: PortfolioInsight }) {
  if (!portfolio.macroContext && portfolio.sectorThemes.length === 0) return null;

  return (
    <DashboardCard title="Market Context" className="min-h-fit">
      <div className="flex flex-col gap-4 px-4 pb-4">
        {portfolio.macroContext && (
          <p className="text-xs leading-relaxed text-text-secondary">{portfolio.macroContext}</p>
        )}
        {portfolio.sectorThemes.length > 0 && (
          <div>
            <span className="mb-2 block text-2xs font-medium uppercase tracking-wider text-text-muted">
              Sector Themes
            </span>
            <div className="flex flex-wrap gap-2">
              {portfolio.sectorThemes.map((theme, i) => (
                <span
                  key={i}
                  className="rounded-md bg-bg-tertiary px-2.5 py-1 text-xs leading-relaxed text-text-secondary"
                >
                  {theme}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
