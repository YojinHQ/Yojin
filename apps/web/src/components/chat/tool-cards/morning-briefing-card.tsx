import { Sun, AlertTriangle, TrendingUp, TrendingDown, Newspaper } from 'lucide-react';
import { useNavigate } from 'react-router';
import { cn } from '../../../lib/utils';
import { usePortfolio, useAlerts, useNews } from '../../../api';
import { SymbolCell } from '../../common/symbol-logo';
import Spinner from '../../common/spinner';
import RichCard from '../rich-card';

function formatCurrency(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return n < 0 ? `-${formatted}` : n > 0 ? `+${formatted}` : formatted;
}

function formatPercent(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export default function MorningBriefingCard() {
  const [{ data: portfolioData, fetching: portfolioFetching }] = usePortfolio();
  const [{ data: alertsData, fetching: alertsFetching }] = useAlerts({ status: 'ACTIVE' });
  const [{ data: newsData, fetching: newsFetching }] = useNews({ limit: 5 });
  const navigate = useNavigate();

  const fetching = portfolioFetching || alertsFetching || newsFetching;

  if (fetching) {
    return (
      <RichCard>
        <RichCard.Header icon={Sun} title="Morning Briefing" badge="DAILY" />
        <div className="flex items-center justify-center px-6 py-8">
          <Spinner size="sm" label="Preparing briefing…" />
        </div>
      </RichCard>
    );
  }

  const portfolio = portfolioData?.portfolio;
  const alerts = alertsData?.alerts ?? [];
  const news = newsData?.news ?? [];
  const positions = portfolio?.positions ?? [];
  const totalValue = portfolio?.totalValue ?? 0;
  const totalPnl = portfolio?.totalPnl ?? 0;
  const totalPnlPercent = portfolio?.totalPnlPercent ?? 0;
  const isPositive = totalPnl >= 0;

  // Top movers — sort by absolute P&L %
  const movers = [...positions]
    .sort((a, b) => Math.abs(b.unrealizedPnlPercent) - Math.abs(a.unrealizedPnlPercent))
    .slice(0, 5);

  return (
    <RichCard>
      <RichCard.Header icon={Sun} title="Morning Briefing" badge="DAILY" />
      <RichCard.Body>
        <span className="font-semibold text-text-primary">{formatDate()}</span> — Your portfolio is valued at{' '}
        {totalValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} across {positions.length}{' '}
        positions.{' '}
        <span className={cn(isPositive ? 'text-success' : 'text-error')}>
          {isPositive ? 'Up' : 'Down'} {formatCurrency(totalPnl)} ({formatPercent(totalPnlPercent)})
        </span>{' '}
        overall.
      </RichCard.Body>
      <RichCard.Stats
        items={[
          { value: totalValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' }), label: 'Total Value' },
          { value: formatCurrency(totalPnl), label: 'Day Change', highlight: true },
          { value: String(alerts.length), label: 'Active Alerts' },
          { value: String(positions.length), label: 'Positions' },
        ]}
      />

      {movers.length > 0 && (
        <>
          <RichCard.SectionLabel>Biggest Movers</RichCard.SectionLabel>
          <RichCard.Table
            columns={[
              { key: 'symbol', header: 'Symbol' },
              { key: 'price', header: 'Price', align: 'right' },
              { key: 'change', header: 'Change', align: 'right' },
              { key: 'direction', header: '', align: 'center' },
            ]}
            rows={movers.map((pos) => ({
              symbol: <SymbolCell symbol={pos.symbol} assetClass={pos.assetClass === 'CRYPTO' ? 'crypto' : 'equity'} />,
              price: pos.currentPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' }),
              change: (
                <span className={cn(pos.unrealizedPnlPercent >= 0 ? 'text-success' : 'text-error')}>
                  {formatPercent(pos.unrealizedPnlPercent)}
                </span>
              ),
              direction:
                pos.unrealizedPnlPercent >= 0 ? (
                  <TrendingUp className="inline h-4 w-4 text-success" />
                ) : (
                  <TrendingDown className="inline h-4 w-4 text-error" />
                ),
            }))}
          />
        </>
      )}

      {alerts.length > 0 && (
        <>
          <RichCard.SectionLabel>Active Alerts</RichCard.SectionLabel>
          <div className="space-y-2 px-6 pb-5">
            {alerts.slice(0, 3).map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-2.5 rounded-lg border border-border bg-bg-secondary px-4 py-3"
              >
                <AlertTriangle
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    alert.severityLabel === 'CRITICAL' ? 'text-error' : 'text-warning',
                  )}
                />
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    {alert.severityLabel} — {alert.symbol}
                  </div>
                  <div className="mt-0.5 text-xs text-text-secondary">{alert.thesis}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {news.length > 0 && (
        <>
          <RichCard.SectionLabel>Recent Headlines</RichCard.SectionLabel>
          <div className="space-y-2 px-6 pb-5">
            {news.slice(0, 3).map((article) => (
              <div
                key={article.id}
                className="flex items-start gap-2.5 rounded-lg border border-border bg-bg-secondary px-4 py-3"
              >
                <Newspaper className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
                <div>
                  <div className="text-sm font-medium text-text-primary">{article.title}</div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    {article.source} {article.symbols.length > 0 && `· ${article.symbols.join(', ')}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <RichCard.Divider />
      <RichCard.Actions
        actions={[
          { label: 'View All Positions', onClick: () => navigate('/portfolio') },
          { label: 'Risk Report', onClick: () => navigate('/chat', { state: { preset: 'Show me my risk report' } }) },
          { label: 'View Alerts', onClick: () => navigate('/strategies') },
        ]}
      />
    </RichCard>
  );
}
