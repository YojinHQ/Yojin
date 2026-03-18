import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';

type PositionStatus = 'holding' | 'watching' | 'pending' | 'sold';

const statusVariant: Record<PositionStatus, BadgeVariant> = {
  holding: 'success',
  watching: 'info',
  pending: 'warning',
  sold: 'neutral',
};

export default function StatusBadge({ status }: { status: PositionStatus }) {
  return <Badge variant={statusVariant[status]}>{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
}
