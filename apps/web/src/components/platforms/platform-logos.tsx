import type { Platform } from '../../api/types';
import { cn } from '../../lib/utils';
import { getPlatformMeta } from './platform-meta';

interface PlatformLogoProps {
  platform: Platform;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeStyles = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

export default function PlatformLogo({ platform, size = 'md', className }: PlatformLogoProps) {
  const meta = getPlatformMeta(platform);
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg font-semibold',
        meta.color,
        sizeStyles[size],
        className,
      )}
      title={meta.label}
    >
      {meta.initials}
    </div>
  );
}
