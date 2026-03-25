import { cn } from '../../lib/utils';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeStyles = {
  sm: { icon: 'h-4 w-4', glow: 'h-6 w-6 -inset-1' },
  md: { icon: 'h-6 w-6', glow: 'h-10 w-10 -inset-2' },
  lg: { icon: 'h-8 w-8', glow: 'h-14 w-14 -inset-3' },
};

export default function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  const s = sizeStyles[size];

  return (
    <span className={cn('relative inline-flex items-center justify-center', s.icon, className)}>
      {/* soft ambient glow */}
      <span className={cn('absolute rounded-full bg-accent-primary/10 blur-md', s.glow)} />
      {/* waving hand */}
      <img
        src="/brand/yojin_icon_color.png"
        alt=""
        className={cn('relative animate-wave', s.icon)}
        style={{ transformOrigin: '70% 85%' }}
      />
    </span>
  );
}
