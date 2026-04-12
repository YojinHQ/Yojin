import { useState } from 'react';
import { Link } from 'react-router';
import { cn } from '../../lib/utils';
import type { SignalGroup } from '../../api/types';
import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';
import Card from '../common/card';

const typeVariant: Record<string, BadgeVariant> = {
  NEWS: 'info',
  FUNDAMENTAL: 'success',
  SENTIMENT: 'warning',
  TECHNICAL: 'neutral',
  MACRO: 'error',
  FILINGS: 'neutral',
  SOCIALS: 'info',
  REGULATORY: 'error',
  TRADING_LOGIC_TRIGGER: 'warning',
};

const sentimentVariant: Record<string, BadgeVariant> = {
  BULLISH: 'success',
  BEARISH: 'error',
  NEUTRAL: 'neutral',
  MIXED: 'warning',
};

function formatTimeRange(first: string, last: string): string {
  const start = new Date(first);
  const end = new Date(last);
  const diffMs = end.getTime() - start.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);
  const diffD = Math.floor(diffH / 24);

  const dateOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startStr = start.toLocaleDateString(undefined, dateOpts);
  const endStr = end.toLocaleDateString(undefined, dateOpts);

  const span = diffD > 0 ? `${diffD}d` : diffH > 0 ? `${diffH}h` : '<1h';

  return startStr === endStr ? `${startStr} (${span})` : `${startStr} - ${endStr} (${span})`;
}

interface SignalGroupCardProps {
  group: SignalGroup;
}

export default function SignalGroupCard({ group }: SignalGroupCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="p-4 transition-all">
      <button
        type="button"
        className="flex w-full items-start justify-between cursor-pointer text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {group.outputType === 'ALERT' && (
              <Badge variant="warning" size="sm">
                ALERT
              </Badge>
            )}
            {group.tickers.map((t) => (
              <Link
                key={t}
                to={`/signals?ticker=${t}`}
                onClick={(e) => e.stopPropagation()}
                className="text-xs font-semibold text-accent-primary hover:underline"
              >
                {t}
              </Link>
            ))}
            <span className="text-xs text-text-muted">{formatTimeRange(group.firstEventAt, group.lastEventAt)}</span>
            <span className="text-xs text-text-muted">
              · {group.signals.length} signal{group.signals.length !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="text-sm font-medium text-text-primary">{group.summary}</p>
        </div>

        <div className="flex items-center ml-3 flex-shrink-0">
          <svg
            className={cn('h-4 w-4 text-text-muted transition-transform', expanded && 'rotate-180')}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="mt-3 border-t border-border pt-3 space-y-2">
          {group.signals.map((signal) => (
            <div key={signal.id} className="flex items-start gap-3 rounded-lg bg-bg-secondary p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Badge variant={typeVariant[signal.type] ?? 'neutral'} size="xs">
                    {signal.type}
                  </Badge>
                  {signal.tier1 && (
                    <Badge
                      variant={
                        signal.tier1 === 'CRITICAL' ? 'error' : signal.tier1 === 'IMPORTANT' ? 'warning' : 'neutral'
                      }
                      size="xs"
                    >
                      {signal.tier1}
                    </Badge>
                  )}
                  {signal.sentiment && (
                    <Badge variant={sentimentVariant[signal.sentiment] ?? 'neutral'} size="xs">
                      {signal.sentiment}
                    </Badge>
                  )}
                  <span className="text-2xs text-text-muted">{new Date(signal.publishedAt).toLocaleString()}</span>
                </div>
                <Link
                  to={`/signals?highlight=${signal.id}`}
                  className="text-xs font-medium text-text-primary hover:text-accent-primary transition-colors"
                >
                  {signal.title}
                </Link>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="flex items-center gap-1.5 w-16">
                  <div className="flex-1 h-1 rounded-full bg-bg-tertiary">
                    <div
                      className={cn(
                        'h-1 rounded-full transition-all',
                        signal.confidence >= 0.8 ? 'bg-success' : signal.confidence >= 0.5 ? 'bg-warning' : 'bg-error',
                      )}
                      style={{ width: `${Math.round(signal.confidence * 100)}%` }}
                    />
                  </div>
                  <span className="text-2xs text-text-muted w-6 text-right">
                    {Math.round(signal.confidence * 100)}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
