import { cn } from '../../lib/utils';

interface RightPanelProps {
  title?: string;
  tabs?: { label: string; active: boolean; onClick: () => void }[];
  children: React.ReactNode;
}

export default function RightPanel({ title, tabs, children }: RightPanelProps) {
  const activeIndex = Math.max(0, tabs?.findIndex((t) => t.active) ?? 0);
  const tabCount = tabs?.length ?? 1;

  return (
    <aside className="flex w-[360px] flex-shrink-0 flex-col overflow-hidden border-l border-border bg-bg-secondary">
      {(title || tabs) && (
        <div className="border-b border-border px-3 py-2">
          {title && <h2 className="text-sm font-medium text-text-primary">{title}</h2>}
          {tabs && (
            <div className="relative flex rounded-lg bg-bg-tertiary p-1">
              {/* Sliding indicator */}
              <div
                className="absolute inset-y-1 left-1 rounded-md bg-bg-hover shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
                style={{
                  width: `calc((100% - 8px) / ${tabCount})`,
                  transform: `translateX(${activeIndex * 100}%)`,
                }}
              />
              {tabs.map((tab) => (
                <button
                  key={tab.label}
                  onClick={tab.onClick}
                  className={cn(
                    'relative z-10 flex-1 cursor-pointer rounded-md py-1.5 text-xs font-medium transition-colors duration-200',
                    tab.active ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary',
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
