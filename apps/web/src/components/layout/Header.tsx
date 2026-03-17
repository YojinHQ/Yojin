export default function Header() {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <h1 className="text-sm font-medium text-slate-400">Personal AI Finance Agent</h1>
      </div>

      <div className="flex items-center gap-4">
        {/* Connection status indicators */}
        <div className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5">
          <StatusDot status="connected" />
          <span className="text-xs text-slate-400">API</span>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5">
          <StatusDot status="connected" />
          <span className="text-xs text-slate-400">Agents</span>
        </div>
      </div>
    </header>
  );
}

function StatusDot({ status }: { status: 'connected' | 'disconnected' | 'loading' }) {
  const colorMap = {
    connected: 'bg-emerald-500',
    disconnected: 'bg-red-500',
    loading: 'bg-amber-500 animate-pulse',
  };

  return <div className={`h-2 w-2 rounded-full ${colorMap[status]}`} />;
}
