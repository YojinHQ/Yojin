import { useMemo } from 'react';
import { useQuery } from 'urql';

import { ACTIVITY_LOG_QUERY } from '../../api/documents';
import type { ActivityEvent, ActivityEventType, ActivityLogQueryResult } from '../../api/types';
import { cn, timeAgo } from '../../lib/utils';
import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';
import { CardEmptyState } from '../common/card-empty-state';
import { DashboardCard } from '../common/dashboard-card';
import Spinner from '../common/spinner';

/* -- Event type config ---------------------------------------------------- */

interface EventTypeConfig {
  label: string;
  badge: BadgeVariant;
  iconColor: string;
  iconBg: string;
  icon: (props: { className?: string }) => React.ReactNode;
}

const EVENT_TYPE_CONFIG: Record<ActivityEventType, EventTypeConfig> = {
  TRADE: {
    label: 'Trade',
    badge: 'accent',
    iconColor: 'text-accent-primary',
    iconBg: 'bg-accent-primary/10',
    icon: TradeIcon,
  },
  SYSTEM: {
    label: 'System',
    badge: 'neutral',
    iconColor: 'text-text-muted',
    iconBg: 'bg-bg-tertiary',
    icon: SystemIcon,
  },
  ACTION: {
    label: 'Action',
    badge: 'accent',
    iconColor: 'text-accent-primary',
    iconBg: 'bg-accent-primary/10',
    icon: ActionIcon,
  },
  ALERT: {
    label: 'Alert',
    badge: 'warning',
    iconColor: 'text-warning',
    iconBg: 'bg-warning/10',
    icon: AlertIcon,
  },
  INSIGHT: {
    label: 'Insight',
    badge: 'success',
    iconColor: 'text-success',
    iconBg: 'bg-success/10',
    icon: InsightIcon,
  },
};

/* -- Icons ---------------------------------------------------------------- */

function TradeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
      />
    </svg>
  );
}

function SystemIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function ActionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
      />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}

function InsightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
      />
    </svg>
  );
}

/* -- Component ------------------------------------------------------------ */

export default function ActivityLog() {
  const [result] = useQuery<ActivityLogQueryResult>({
    query: ACTIVITY_LOG_QUERY,
    variables: { limit: 50 },
  });

  const events = useMemo(() => result.data?.activityLog ?? [], [result.data?.activityLog]);

  if (result.fetching) {
    return (
      <DashboardCard title="Activity Log" variant="feature" className="flex-1">
        <div className="flex flex-1 items-center justify-center px-5 pb-5">
          <Spinner size="md" label="Loading activity..." />
        </div>
      </DashboardCard>
    );
  }

  if (result.error) {
    return (
      <DashboardCard title="Activity Log" variant="feature" className="flex-1">
        <CardEmptyState
          icon={
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              />
            </svg>
          }
          title="Failed to load activity"
          description="Could not fetch activity log. Try refreshing the page."
        />
      </DashboardCard>
    );
  }

  if (!result.data || events.length === 0) {
    return (
      <DashboardCard title="Activity Log" variant="feature" className="flex-1">
        <CardEmptyState
          icon={
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
          }
          title="No activity yet"
          description="Events will appear here as you use Yojin."
        />
      </DashboardCard>
    );
  }

  return (
    <DashboardCard
      title="Activity Log"
      variant="feature"
      className="flex-1"
      headerAction={<span className="text-xs text-text-muted">{events.length} events</span>}
    >
      {/* Event list */}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-3 pb-3">
        {events.map((event) => (
          <ActivityEventRow key={event.id} event={event} />
        ))}
      </div>
    </DashboardCard>
  );
}

/* -- Event row ------------------------------------------------------------ */

function ActivityEventRow({ event }: { event: ActivityEvent }) {
  const config = EVENT_TYPE_CONFIG[event.type];
  const Icon = config.icon;

  return (
    <div className="group flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-bg-hover">
      <div className={cn('mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md', config.iconBg)}>
        <Icon className={cn('h-3.5 w-3.5', config.iconColor)} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Badge variant={config.badge} size="xs">
            {config.label}
          </Badge>
          {event.ticker && <span className="text-2xs font-semibold text-text-secondary">{event.ticker}</span>}
          <span className="ml-auto flex-shrink-0 text-2xs text-text-muted">{timeAgo(event.timestamp)}</span>
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-text-secondary group-hover:text-text-primary">
          {event.message}
        </p>
      </div>
    </div>
  );
}
