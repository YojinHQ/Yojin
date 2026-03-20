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
    color: 'bg-red-500/20 text-red-400',
    description: 'Stocks, options, futures, forex',
  },
  ROBINHOOD: {
    label: 'Robinhood',
    initials: 'RH',
    color: 'bg-green-500/20 text-green-400',
    description: 'Stocks, options, crypto',
  },
  COINBASE: {
    label: 'Coinbase',
    initials: 'CB',
    color: 'bg-blue-500/20 text-blue-400',
    description: 'Cryptocurrency exchange',
  },
  SCHWAB: {
    label: 'Charles Schwab',
    initials: 'CS',
    color: 'bg-cyan-500/20 text-cyan-400',
    description: 'Stocks, ETFs, mutual funds',
  },
  BINANCE: {
    label: 'Binance',
    initials: 'BN',
    color: 'bg-yellow-500/20 text-yellow-400',
    description: 'Cryptocurrency exchange',
  },
  FIDELITY: {
    label: 'Fidelity',
    initials: 'FD',
    color: 'bg-emerald-500/20 text-emerald-400',
    description: 'Stocks, bonds, mutual funds',
  },
  POLYMARKET: {
    label: 'Polymarket',
    initials: 'PM',
    color: 'bg-purple-500/20 text-purple-400',
    description: 'Prediction markets',
  },
  PHANTOM: {
    label: 'Phantom',
    initials: 'PH',
    color: 'bg-violet-500/20 text-violet-400',
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
