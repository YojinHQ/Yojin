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
  return CRYPTO_SYMBOLS.has(symbol.toUpperCase()) || /-USDT?$/i.test(symbol);
}

export function inferAssetClass(symbol: string): AssetClass {
  return isCryptoSymbol(symbol) ? 'CRYPTO' : 'EQUITY';
}
