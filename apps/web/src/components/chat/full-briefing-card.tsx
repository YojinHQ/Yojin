import { AlertTriangle, BarChart3, CheckCircle, TrendingDown } from 'lucide-react';
import { SymbolCell } from '../common/symbol-logo';
import RichCard from './rich-card';

function StatusIndicator({ variant, label }: { variant: 'success' | 'warning' | 'error'; label: string }) {
  const styles = {
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-error',
  };

  const icons = {
    success: CheckCircle,
    warning: AlertTriangle,
    error: TrendingDown,
  };

  const Icon = icons[variant];

  return (
    <span className={`flex items-center gap-1.5 ${styles[variant]}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export default function FullBriefingCard() {
  return (
    <RichCard>
      <RichCard.Header icon={BarChart3} title="Morning Briefing — Full Report" badge="DAILY" />
      <RichCard.Body>
        Your portfolio is up 1.2% since yesterday&apos;s close. Three positions need attention: NVDA earnings beat
        expectations but guidance was mixed, TSLA hit a 52-week low, and your AAPL position crossed the 30%
        concentration threshold.
      </RichCard.Body>
      <RichCard.Stats
        items={[
          { value: '$124,500', label: 'Total Value' },
          { value: '+$1,470', label: 'Day Change', highlight: true },
          { value: '23.4%', label: 'YTD Return' },
          { value: '72', label: 'Risk Score' },
        ]}
      />
      <RichCard.Table
        columns={[
          { key: 'symbol', header: 'Symbol' },
          { key: 'price', header: 'Price' },
          { key: 'change', header: 'Day Change' },
          { key: 'status', header: 'Status' },
        ]}
        rows={[
          {
            symbol: <SymbolCell symbol="AAPL" />,
            price: '$198.50',
            change: '+1.8%',
            status: <StatusIndicator variant="warning" label="Concentrated" />,
          },
          {
            symbol: <SymbolCell symbol="NVDA" />,
            price: '$875.30',
            change: '+3.2%',
            status: <StatusIndicator variant="success" label="Earnings Beat" />,
          },
          {
            symbol: <SymbolCell symbol="TSLA" />,
            price: '$162.10',
            change: '-4.1%',
            status: <StatusIndicator variant="error" label="52w Low" />,
          },
          {
            symbol: <SymbolCell symbol="MSFT" />,
            price: '$415.80',
            change: '+0.6%',
            status: <StatusIndicator variant="success" label="Healthy" />,
          },
          {
            symbol: <SymbolCell symbol="AMZN" />,
            price: '$186.20',
            change: '+1.1%',
            status: <StatusIndicator variant="success" label="Healthy" />,
          },
        ]}
      />
      <RichCard.Divider />
      <RichCard.Actions
        actions={[{ label: 'Rebalance Portfolio' }, { label: 'View Risk Report' }, { label: 'Set Alerts' }]}
      />
    </RichCard>
  );
}
