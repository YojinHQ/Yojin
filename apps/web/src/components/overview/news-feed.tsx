import { cn } from '../../lib/utils';

interface NewsItem {
  source: string;
  time: string;
  title: string;
  tag: string;
}

const newsItems: NewsItem[] = [
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

const tagColors: Record<string, string> = {
  Economy: 'bg-info/10 text-info',
  Earnings: 'bg-success/10 text-success',
  Market: 'bg-accent-primary/10 text-accent-primary',
  Tech: 'bg-accent-secondary/10 text-accent-secondary',
  Global: 'bg-warning/10 text-warning',
};

export default function NewsFeed() {
  return (
    <div className="divide-y divide-border">
      {newsItems.map((item, i) => (
        <div key={i} className="px-3 py-2.5 hover:bg-bg-hover transition-colors cursor-pointer">
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span className="font-medium">{item.source}</span>
            <span>{item.time}</span>
          </div>
          <p className="mt-1 text-xs leading-snug text-text-primary">{item.title}</p>
          <span
            className={cn(
              'mt-1 inline-block rounded-full px-1.5 py-px text-[10px] font-medium',
              tagColors[item.tag] ?? 'bg-bg-tertiary text-text-muted',
            )}
          >
            {item.tag}
          </span>
        </div>
      ))}
    </div>
  );
}
