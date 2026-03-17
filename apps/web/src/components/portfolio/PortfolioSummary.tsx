import Card from '../common/Card';

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
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            {card.label}
          </p>
          <p className="mt-2 text-2xl font-semibold text-white">{card.value}</p>
          {card.change && (
            <p
              className={`mt-1 text-sm ${
                card.changeType === 'positive'
                  ? 'text-emerald-400'
                  : card.changeType === 'negative'
                    ? 'text-red-400'
                    : 'text-slate-500'
              }`}
            >
              {card.change}
            </p>
          )}
        </Card>
      ))}
    </div>
  );
}
