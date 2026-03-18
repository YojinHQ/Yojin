import { cn } from '../../lib/utils';

interface Alert {
  type: 'action' | 'alert' | 'insight';
  label: string;
  title: string;
  description: string;
  urgency: 'high' | 'medium' | 'low';
}

const alerts: Alert[] = [
  {
    type: 'action',
    label: 'Action',
    title: 'Rebalance Portfolio',
    description: 'Tech allocation exceeds 45% target. Consider trimming NVDA position.',
    urgency: 'high',
  },
  {
    type: 'alert',
    label: 'Alert',
    title: 'Earnings This Week',
    description: 'AAPL reports earnings Thursday after market close. Current position: 150 shares.',
    urgency: 'medium',
  },
  {
    type: 'insight',
    label: 'Insight',
    title: 'Correlation Detected',
    description: 'MSFT and GOOGL showing 0.92 correlation over 30 days.',
    urgency: 'low',
  },
  {
    type: 'action',
    label: 'Action',
    title: 'Stop Loss Triggered',
    description: 'META approaching -8% drawdown threshold. Review exit strategy.',
    urgency: 'high',
  },
];

const badgeStyles: Record<Alert['type'], string> = {
  action: 'bg-accent-primary/15 text-accent-primary',
  alert: 'bg-warning/15 text-warning',
  insight: 'bg-info/15 text-info',
};

const urgencyIndicator: Record<Alert['urgency'], string> = {
  high: 'bg-error',
  medium: 'bg-warning',
  low: 'bg-info',
};

export default function IntelAlerts() {
  return (
    <div className="space-y-1.5 p-3">
      {alerts.map((alert, i) => (
        <div key={i} className="rounded-md bg-bg-tertiary p-2.5">
          <div className="mb-1 flex items-center gap-1.5">
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full', urgencyIndicator[alert.urgency])} />
            <span className={cn('rounded-full px-1.5 py-px text-[10px] font-medium', badgeStyles[alert.type])}>
              {alert.label}
            </span>
          </div>
          <p className="text-xs font-medium text-text-primary">{alert.title}</p>
          <p className="mt-0.5 text-[11px] leading-snug text-text-secondary">{alert.description}</p>
        </div>
      ))}
    </div>
  );
}
