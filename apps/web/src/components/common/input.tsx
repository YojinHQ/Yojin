import { cn } from '../../lib/utils';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  size?: 'sm' | 'md' | 'lg';
}

const sizeStyles = {
  sm: 'px-3 py-1.5 text-xs rounded-lg',
  md: 'px-3 py-2 text-sm rounded-lg',
  lg: 'px-4 py-2.5 text-sm rounded-xl',
};

export default function Input({ label, hint, error, size = 'md', className, id, ...props }: InputProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-text-secondary">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={cn(
          'w-full border bg-bg-card text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/20',
          error ? 'border-error' : 'border-border',
          sizeStyles[size],
          className,
        )}
        {...props}
      />
      {error && <p className="text-xs text-error">{error}</p>}
      {!error && hint && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

export type { InputProps };
