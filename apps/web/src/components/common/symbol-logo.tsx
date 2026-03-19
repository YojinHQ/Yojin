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

function getLogoUrl(symbol: string, assetClass: AssetClass): string {
  const path = assetClass === 'crypto' ? 'crypto' : 'symbol';
  return `https://assets.parqet.com/logos/${path}/${symbol}`;
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
  const [imgError, setImgError] = useState(false);

  return (
    <div
      className={cn(
        'flex-shrink-0 rounded-full flex items-center justify-center overflow-hidden',
        sizeStyles[size],
        className,
      )}
      style={imgError ? { backgroundColor: getColor(symbol) } : undefined}
    >
      {imgError ? (
        <span className="font-semibold leading-none text-white">{symbol.slice(0, 2)}</span>
      ) : (
        <img
          src={getLogoUrl(symbol, assetClass)}
          alt={`${symbol} logo`}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      )}
    </div>
  );
}
