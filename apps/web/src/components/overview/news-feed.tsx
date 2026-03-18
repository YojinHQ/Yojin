import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';

export interface FeedItem {
  source: string;
  time: string;
  title: string;
  tag: string;
}

export const newsItems: FeedItem[] = [
  {
    source: 'Reuters',
    time: '2h ago',
    title: 'Fed signals potential rate adjustment in upcoming meeting',
    tag: 'Economy',
  },
  {
    source: 'Bloomberg',
    time: '3h ago',
    title: 'NVDA reports record quarterly revenue, beats estimates',
    tag: 'Earnings',
  },
  {
    source: 'WSJ',
    time: '5h ago',
    title: 'Tech sector rotation accelerates amid valuation concerns',
    tag: 'Market',
  },
  {
    source: 'CNBC',
    time: '6h ago',
    title: 'Apple unveils new AI features for enterprise customers',
    tag: 'Tech',
  },
  {
    source: 'FT',
    time: '8h ago',
    title: 'European markets rally on improved economic outlook',
    tag: 'Global',
  },
];

export const intelItems: FeedItem[] = [
  {
    source: 'Risk Manager',
    time: 'Just now',
    title: 'Tech allocation exceeds 45% target — consider trimming NVDA',
    tag: 'Action',
  },
  {
    source: 'Research Analyst',
    time: '15m ago',
    title: 'Unusual volume spike in semiconductor sector: NVDA, AMD, AVGO at 2x avg',
    tag: 'Insight',
  },
  {
    source: 'Risk Manager',
    time: '30m ago',
    title: 'AAPL reports earnings Thursday after close. Current position: 150 shares',
    tag: 'Alert',
  },
  {
    source: 'Strategist',
    time: '1h ago',
    title: 'MSFT-GOOGL 30-day correlation dropped from 0.92 to 0.67',
    tag: 'Insight',
  },
  {
    source: 'Risk Manager',
    time: '2h ago',
    title: 'META approaching -8% drawdown threshold. Review stop loss orders',
    tag: 'Alert',
  },
  {
    source: 'Strategist',
    time: '3h ago',
    title: 'Capital rotating from growth to value sectors — portfolio is growth-heavy',
    tag: 'Insight',
  },
];

const tagVariant: Record<string, BadgeVariant> = {
  Economy: 'info',
  Earnings: 'success',
  Market: 'accent',
  Tech: 'accent',
  Global: 'warning',
  Action: 'accent',
  Alert: 'warning',
  Insight: 'success',
};

export function FeedList({ items }: { items: FeedItem[] }) {
  return (
    <div className="divide-y divide-border">
      {items.map((item, i) => (
        <div key={i} className="px-3 py-2.5 hover:bg-bg-hover transition-colors cursor-pointer">
          <div className="flex items-center justify-between text-2xs text-text-muted">
            <span className="font-medium">{item.source}</span>
            <span>{item.time}</span>
          </div>
          <p className="mt-0.5 text-xs leading-snug text-text-primary">{item.title}</p>
          <Badge variant={tagVariant[item.tag] ?? 'neutral'} className="mt-1">
            {item.tag}
          </Badge>
        </div>
      ))}
    </div>
  );
}

export default function NewsFeed() {
  return <FeedList items={newsItems} />;
}
