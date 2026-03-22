import type { KnownPlatform, Platform } from '../../api/types';
import { isKnownPlatform } from '../../api/types';

/**
 * Platform display metadata — names, descriptions, and placeholder initials.
 * Replace initials with SVG logos when branding assets are available.
 */

export interface PlatformMeta {
  label: string;
  initials: string;
  color: string;
  description: string;
}

const PLATFORM_META: Record<KnownPlatform, PlatformMeta> = {
  INTERACTIVE_BROKERS: {
    label: 'Interactive Brokers',
    initials: 'IB',
    color: 'bg-accent-primary/20 text-accent-primary',
    description: 'Stocks, options, futures, forex',
  },
  ROBINHOOD: {
    label: 'Robinhood',
    initials: 'RH',
    color: 'bg-success/20 text-success',
    description: 'Stocks, options, crypto',
  },
  COINBASE: {
    label: 'Coinbase',
    initials: 'CB',
    color: 'bg-info/20 text-info',
    description: 'Cryptocurrency exchange',
  },
  SCHWAB: {
    label: 'Charles Schwab',
    initials: 'CS',
    color: 'bg-platform-cyan/20 text-platform-cyan',
    description: 'Stocks, ETFs, mutual funds',
  },
  BINANCE: {
    label: 'Binance',
    initials: 'BN',
    color: 'bg-warning/20 text-warning',
    description: 'Cryptocurrency exchange',
  },
  FIDELITY: {
    label: 'Fidelity',
    initials: 'FD',
    color: 'bg-platform-teal/20 text-platform-teal',
    description: 'Stocks, bonds, mutual funds',
  },
  POLYMARKET: {
    label: 'Polymarket',
    initials: 'PM',
    color: 'bg-market/20 text-market',
    description: 'Prediction markets',
  },
  PHANTOM: {
    label: 'Phantom',
    initials: 'PH',
    color: 'bg-platform-violet/20 text-platform-violet',
    description: 'Solana wallet',
  },
  MANUAL: {
    label: 'Manual',
    initials: 'MA',
    color: 'bg-bg-tertiary text-text-muted',
    description: 'CSV upload or manual entry',
  },
};

const DEFAULT_META: PlatformMeta = {
  label: 'Unknown',
  initials: '??',
  color: 'bg-bg-tertiary text-text-muted',
  description: 'Custom platform',
};

export function getPlatformMeta(platform: Platform): PlatformMeta {
  if (isKnownPlatform(platform)) return PLATFORM_META[platform];
  return { ...DEFAULT_META, label: platform, initials: platform.slice(0, 2).toUpperCase() };
}
