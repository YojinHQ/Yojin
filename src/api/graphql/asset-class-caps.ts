/**
 * Asset class capabilities — central behavioural matrix for each `AssetClass`.
 *
 * Historically the codebase hard-coded `assetClass === 'CRYPTO' ? … : …` in
 * many places (live enrichment, UI logo selection, market-hour gating, etc.),
 * which meant every new class (CURRENCY for fiat cash, BOND, COMMODITY) had to
 * chase down every ternary. Route new code through `getAssetCaps()` instead —
 * adding a new class becomes a one-line change here.
 */

import type { AssetClass } from './types.js';

export interface AssetClassCapabilities {
  /** Fetch live market quotes (Jintel `/quotes`, price history). */
  hasLiveQuotes: boolean;
  /** Emits an intraday sparkline — implies `hasLiveQuotes`. */
  hasSparkline: boolean;
  /** Trading follows US equity regular hours (9:30–16:00 ET). Crypto trades 24/7. Cash has no "session". */
  followsEquityMarketHours: boolean;
  /** Which logo asset pack to try first for rendering. */
  logoKind: 'symbol' | 'crypto' | 'currency';
  /** Price is always 1 in its own denomination (e.g. fiat cash: 1 USD = $1). */
  priceIsFixed: boolean;
}

const CAPS: Record<AssetClass, AssetClassCapabilities> = {
  EQUITY: {
    hasLiveQuotes: true,
    hasSparkline: true,
    followsEquityMarketHours: true,
    logoKind: 'symbol',
    priceIsFixed: false,
  },
  CRYPTO: {
    hasLiveQuotes: true,
    hasSparkline: true,
    followsEquityMarketHours: false,
    logoKind: 'crypto',
    priceIsFixed: false,
  },
  CURRENCY: {
    hasLiveQuotes: false,
    hasSparkline: false,
    followsEquityMarketHours: false,
    logoKind: 'currency',
    priceIsFixed: true,
  },
  BOND: {
    hasLiveQuotes: false,
    hasSparkline: false,
    followsEquityMarketHours: true,
    logoKind: 'symbol',
    priceIsFixed: false,
  },
  COMMODITY: {
    hasLiveQuotes: true,
    hasSparkline: true,
    followsEquityMarketHours: true,
    logoKind: 'symbol',
    priceIsFixed: false,
  },
  OTHER: {
    hasLiveQuotes: false,
    hasSparkline: false,
    followsEquityMarketHours: false,
    logoKind: 'symbol',
    priceIsFixed: false,
  },
};

export function getAssetCaps(assetClass: AssetClass): AssetClassCapabilities {
  return CAPS[assetClass] ?? CAPS.OTHER;
}
