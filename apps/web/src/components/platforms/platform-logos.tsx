import { useState } from 'react';

import type { KnownPlatform, Platform } from '../../api/types';
import { isKnownPlatform } from '../../api/types';
import { cn } from '../../lib/utils';
import { getPlatformMeta } from './platform-meta';

interface PlatformLogoProps {
  platform: Platform;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeStyles = {
  xs: 'h-5 w-5 text-[9px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

/** Map platform IDs to their logo filenames in /platforms/. */
const LOGO_FILES: Record<KnownPlatform, string> = {
  INTERACTIVE_BROKERS: 'interactive-brokers.png',
  ROBINHOOD: 'robinhood.png',
  COINBASE: 'coinbase.png',
  SCHWAB: 'schwab.png',
  BINANCE: 'binance.png',
  FIDELITY: 'fidelity.png',
  POLYMARKET: 'polymarket.png',
  PHANTOM: 'phantom.png',
  METAMASK: 'metamask.png',
  WEBULL: 'webull.png',
  SOFI: 'sofi.png',
  MOOMOO: 'moomoo.png',
  MANUAL: '',
};

export function PlatformLogo({ platform, size = 'md', className }: PlatformLogoProps) {
  const meta = getPlatformMeta(platform);
  const [imgError, setImgError] = useState(false);

  const logoFile = isKnownPlatform(platform) ? LOGO_FILES[platform] : '';
  const hasLogo = logoFile && !imgError;

  if (hasLogo) {
    return (
      <img
        src={`/platforms/${logoFile}`}
        alt={meta.label}
        onError={() => setImgError(true)}
        className={cn('rounded-lg object-contain', sizeStyles[size], className)}
      />
    );
  }

  // Fallback: colored initials badge
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
