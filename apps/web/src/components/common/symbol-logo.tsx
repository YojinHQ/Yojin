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

function getLogoUrls(symbol: string, assetClass: AssetClass): string[] {
  const urls: string[] = [];

  // 1. Parqet (works well for equities and some crypto)
  const parqetPath = assetClass === 'crypto' ? 'crypto' : 'symbol';
  urls.push(`https://assets.parqet.com/logos/${parqetPath}/${symbol}`);

  // 2. Also try Parqet crypto path if asset class is equity (might be misclassified)
  if (assetClass !== 'crypto') {
    urls.push(`https://assets.parqet.com/logos/crypto/${symbol}`);
  }

  return urls;
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
