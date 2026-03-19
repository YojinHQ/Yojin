import { useParams } from 'react-router';
import Card from '../components/common/card';

function PlaceholderCard({ title, description }: { title: string; description: string }) {
  return (
    <Card title={title}>
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-text-muted">{description}</p>
      </div>
    </Card>
  );
}

export default function Position() {
  const { symbol } = useParams<{ symbol: string }>();

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{symbol?.toUpperCase()}</h2>
          <p className="mt-1 text-sm text-text-muted">Position details, research, and analysis.</p>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {['Current Price', 'Quantity', 'Market Value', 'Total P&L'].map((label) => (
          <Card key={label}>
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
            <p className="mt-1.5 text-base font-semibold text-text-primary">--</p>
          </Card>
        ))}
      </div>

      {/* Detail sections */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PlaceholderCard title="Price Chart" description="Price chart will be rendered here." />
        <PlaceholderCard title="Fundamentals" description="Fundamental data from OpenBB SDK will appear here." />
        <PlaceholderCard
          title="Technical Indicators"
          description="SMA, RSI, BBANDS, and other technicals will be shown here."
        />
        <PlaceholderCard
          title="News & Sentiment"
          description="Latest news and Keelson sentiment data will appear here."
        />
      </div>
    </div>
  );
}
