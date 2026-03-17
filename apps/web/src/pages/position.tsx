import { useParams, Link } from 'react-router';
import Card from '../components/common/card';

export default function Position() {
  const { symbol } = useParams<{ symbol: string }>();

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/portfolio" className="text-text-muted hover:text-text-secondary">
          Portfolio
        </Link>
        <span className="text-text-muted">/</span>
        <span className="text-text-primary">{symbol?.toUpperCase()}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary">{symbol?.toUpperCase()}</h2>
          <p className="mt-1 text-sm text-text-muted">Position details, research, and analysis.</p>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {['Current Price', 'Quantity', 'Market Value', 'Total P&L'].map((label) => (
          <Card key={label}>
            <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
            <p className="mt-2 text-xl font-semibold text-text-primary">--</p>
          </Card>
        ))}
      </div>

      {/* Detail sections */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Price Chart">
          <div className="flex h-64 items-center justify-center">
            <p className="text-sm text-text-muted">Price chart will be rendered here.</p>
          </div>
        </Card>

        <Card title="Fundamentals">
          <div className="flex h-64 items-center justify-center">
            <p className="text-sm text-text-muted">
              Fundamental data from OpenBB SDK will appear here.
            </p>
          </div>
        </Card>

        <Card title="Technical Indicators">
          <div className="flex h-64 items-center justify-center">
            <p className="text-sm text-text-muted">
              SMA, RSI, BBANDS, and other technicals will be shown here.
            </p>
          </div>
        </Card>

        <Card title="News & Sentiment">
          <div className="flex h-64 items-center justify-center">
            <p className="text-sm text-text-muted">
              Latest news and Keelson sentiment data will appear here.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
