import { cn } from '../../lib/utils';

interface Tab {
  label: string;
  value: string;
}

interface TabsProps {
  tabs: Tab[];
  value: string;
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
}

const sizeStyles = {
  sm: { container: 'gap-0.5 p-0.5', button: 'px-2.5 py-0.5 text-xs' },
  md: { container: 'gap-1 p-1', button: 'px-3 py-1.5 text-sm' },
};

export default function Tabs({ tabs, value, onChange, size = 'md' }: TabsProps) {
  const styles = sizeStyles[size];

  return (
    <div className={cn('flex rounded-lg bg-bg-tertiary/50', styles.container)}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            'rounded-md font-medium transition-colors',
            styles.button,
            value === tab.value
              ? 'border border-border bg-bg-card text-text-primary'
              : 'border border-transparent text-text-muted hover:text-text-secondary',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export type { Tab, TabsProps };
