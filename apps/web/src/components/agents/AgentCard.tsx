import Card from '../common/Card';
import Badge from '../common/Badge';

interface AgentCardProps {
  name: string;
  role: string;
  description: string;
  status: 'idle' | 'active' | 'error';
  lastRun?: string;
}

const statusVariant = {
  idle: 'info' as const,
  active: 'success' as const,
  error: 'error' as const,
};

const statusLabel = {
  idle: 'Idle',
  active: 'Active',
  error: 'Error',
};

export default function AgentCard({ name, role, description, status, lastRun }: AgentCardProps) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800">
            <svg
              className="h-5 w-5 text-emerald-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"
              />
            </svg>
          </div>
          <div>
            <h4 className="text-sm font-medium text-white">{name}</h4>
            <p className="text-xs text-slate-500">{role}</p>
          </div>
        </div>
        <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>
      </div>
      <p className="mt-3 text-sm text-slate-400">{description}</p>
      {lastRun && <p className="mt-3 text-xs text-slate-600">Last run: {lastRun}</p>}
    </Card>
  );
}
