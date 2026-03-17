import Card from '../common/card';
import { cn } from '../../lib/utils';

interface SummaryCardData {
  label: string;
  value: string;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
}

const summaryCards: SummaryCardData[] = [
  { label: 'Total Value', value: '--', change: undefined, changeType: 'neutral' },
  { label: 'Day P&L', value: '--', change: undefined, changeType: 'neutral' },
  { label: 'Total Return', value: '--', change: undefined, changeType: 'neutral' },
  { label: 'Positions', value: '--', change: undefined, changeType: 'neutral' },
];

export default function PortfolioSummary() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {summaryCards.map((card) => (
        <Card key={card.label}>
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{card.label}</p>
          <p className="mt-2 text-2xl font-semibold text-text-primary">{card.value}</p>
          {card.change && (
            <p
              className={cn(
                'mt-1 text-sm',
                card.changeType === 'positive'
                  ? 'text-success'
                  : card.changeType === 'negative'
                    ? 'text-error'
                    : 'text-text-muted',
              )}
            >
              {card.change}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}
