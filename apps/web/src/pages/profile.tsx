import { cn } from '../lib/utils';
import Card from '../components/common/card';

export default function Profile() {
  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-primary/20 text-xl font-semibold text-accent-primary">
            DS
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Dean Shaked</h2>
            <p className="text-sm text-text-muted">@dean</p>
          </div>
        </div>
      </Card>

      <Card title="Account Information" section>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Display Name" value="Dean Shaked" />
          <Field label="Username" value="@dean" />
          <Field label="Email" value="dean@yojin.ai" />
          <Field label="Role" value="Owner" />
        </div>
      </Card>

      <Card title="Connected Platforms" section>
        <div className="space-y-3">
          <PlatformRow name="Interactive Brokers" status="connected" />
          <PlatformRow name="Coinbase" status="connected" />
          <PlatformRow name="Robinhood" status="disconnected" />
        </div>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-text-muted mb-1">{label}</p>
      <p className="text-sm text-text-primary">{value}</p>
    </div>
  );
}

function PlatformRow({ name, status }: { name: string; status: 'connected' | 'disconnected' }) {
  const connected = status === 'connected';
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
      <span className="text-sm text-text-primary">{name}</span>
      <span className={cn('text-xs font-medium', connected ? 'text-success' : 'text-text-muted')}>
        {connected ? 'Connected' : 'Not connected'}
      </span>
    </div>
  );
}
