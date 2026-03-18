import { cn } from '../../lib/utils';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  label?: string;
  description?: string;
}

const trackSize = {
  sm: 'h-4 w-7',
  md: 'h-5 w-9',
};

const thumbSize = {
  sm: 'after:h-3 after:w-3',
  md: 'after:h-4 after:w-4',
};

export default function Toggle({
  checked,
  onChange,
  size = 'md',
  disabled = false,
  label,
  description,
}: ToggleProps) {
  const toggle = (
    <label className={cn('relative inline-flex cursor-pointer items-center', disabled && 'cursor-not-allowed opacity-40')}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="peer sr-only"
      />
      <div
        className={cn(
          'rounded-full bg-bg-tertiary peer-checked:bg-accent-primary peer-focus:ring-2 peer-focus:ring-accent-primary/20 after:absolute after:left-[2px] after:top-[2px] after:rounded-full after:bg-text-primary after:transition-all peer-checked:after:translate-x-full',
          trackSize[size],
          thumbSize[size],
        )}
      />
    </label>
  );

  if (!label) return toggle;

  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-text-primary">{label}</p>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
      {toggle}
    </div>
  );
}

export type { ToggleProps };
