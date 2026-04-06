import { useState } from 'react';
import { cn } from '../../lib/utils';

type AssetClass = 'equity' | 'crypto';

interface SymbolLogoProps {
  symbol: string;
  assetClass?: AssetClass;
  size?: 'sm' | 'md';
  className?: string;
}

const sizeStyles = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
} as const;

const PALETTE = [
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
  '#06b6d4',
  '#6366f1',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
  '#ef4444',
];

function getColor(symbol: string): string {
  let hash = 0;
  for (const char of symbol) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/** Local logo overrides — used when the CDN asset is broken or incorrect. */
const LOCAL_LOGOS: Record<string, string> = {
  USDC: '/logos/usdc.svg',
};

function getLogoUrls(symbol: string, assetClass: AssetClass): string[] {
  const local = LOCAL_LOGOS[symbol];
  if (local) return [local];

  const primary = assetClass === 'crypto' ? 'crypto' : 'symbol';
  const fallback = assetClass === 'crypto' ? 'symbol' : 'crypto';

  return [
    `https://assets.parqet.com/logos/${primary}/${symbol}`,
    `https://assets.parqet.com/logos/${fallback}/${symbol}`,
  ];
}

interface SymbolCellProps {
  symbol: string;
  assetClass?: AssetClass;
  size?: 'sm' | 'md';
  className?: string;
}

export function SymbolCell({ symbol, assetClass = 'equity', size = 'sm', className }: SymbolCellProps) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <SymbolLogo symbol={symbol} assetClass={assetClass} size={size} />
      {symbol}
    </span>
  );
}

export function SymbolLogo({ symbol, assetClass = 'equity', size = 'sm', className }: SymbolLogoProps) {
  const [urlIndex, setUrlIndex] = useState(0);
  const urls = getLogoUrls(symbol, assetClass);
  const exhausted = urlIndex >= urls.length;

  return (
    <div
      className={cn(
        'flex-shrink-0 rounded-full flex items-center justify-center overflow-hidden',
        sizeStyles[size],
        className,
      )}
      style={exhausted ? { backgroundColor: getColor(symbol) } : undefined}
    >
      {exhausted ? (
        <span className="font-semibold leading-none text-white">{symbol.slice(0, 2)}</span>
      ) : (
        <img
          src={urls[urlIndex]}
          alt={`${symbol} logo`}
          className="h-full w-full object-cover"
          onError={() => setUrlIndex((i) => i + 1)}
        />
      )}
    </div>
  );
}
