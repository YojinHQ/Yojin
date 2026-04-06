/**
 * Known stablecoin symbols — pegged assets with no meaningful price movement.
 * Used to filter noise from at-a-glance views (overview cards) while keeping
 * them visible on the full portfolio page.
 */
export const STABLECOINS = new Set([
  'USDC',
  'USDT',
  'DAI',
  'BUSD',
  'TUSD',
  'FRAX',
  'USDP',
  'GUSD',
  'PYUSD',
  'FDUSD',
  'USDD',
  'LUSD',
  'CRVUSD',
  'GHO',
  'EURC',
]);

export function isStablecoin(symbol: string): boolean {
  return STABLECOINS.has(symbol.toUpperCase());
}
