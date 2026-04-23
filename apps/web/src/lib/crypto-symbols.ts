import type { AssetClass } from '../api/types';

export const CRYPTO_SYMBOLS = new Set([
  'BTC',
  'ETH',
  'SOL',
  'ADA',
  'XRP',
  'DOGE',
  'DOT',
  'AVAX',
  'MATIC',
  'LINK',
  'UNI',
  'ATOM',
  'LTC',
  'BCH',
  'ALGO',
  'FIL',
  'NEAR',
  'APT',
  'ARB',
  'OP',
]);

export function isCryptoSymbol(symbol: string): boolean {
  const upper = symbol.toUpperCase();
  if (CRYPTO_SYMBOLS.has(upper)) return true;
  const base = /^([A-Z0-9]+)-(?:USDT?)$/.exec(upper)?.[1];
  return base !== undefined && CRYPTO_SYMBOLS.has(base);
}

export function inferAssetClass(symbol: string): AssetClass {
  return isCryptoSymbol(symbol) ? 'CRYPTO' : 'EQUITY';
}
