import { cn } from '../../lib/utils';

type PositionStatus = 'holding' | 'watching' | 'pending' | 'sold';

const statusStyles: Record<PositionStatus, string> = {
  holding: 'bg-success/10 text-success',
  watching: 'bg-info/10 text-info',
  pending: 'bg-warning/10 text-warning',
  sold: 'bg-text-muted/10 text-text-muted',
};

export default function StatusBadge({ status }: { status: PositionStatus }) {
  return (
    <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-xs font-medium', statusStyles[status])}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
