import { cn } from '../../lib/utils';

interface RightPanelProps {
  title?: string;
  tabs?: { label: string; active: boolean; onClick: () => void }[];
  children: React.ReactNode;
}

export default function RightPanel({ title, tabs, children }: RightPanelProps) {
  return (
    <aside className="flex w-[320px] flex-shrink-0 flex-col overflow-hidden border-l border-border bg-bg-secondary">
      {(title || tabs) && (
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          {title && <h2 className="text-sm font-medium text-text-primary">{title}</h2>}
          {tabs && (
            <div className="flex gap-0.5 rounded-md bg-bg-tertiary p-0.5">
              {tabs.map((tab) => (
                <button
                  key={tab.label}
                  onClick={tab.onClick}
                  className={cn(
                    'rounded px-2.5 py-0.5 text-xs transition-colors',
                    tab.active ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-secondary',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex-1 overflow-auto">{children}</div>
    </aside>
  );
}
