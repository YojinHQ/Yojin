import { useMemo } from 'react';

import { usePortfolio } from '../../api/hooks/index.js';
import type { Position, PortfolioSnapshot } from '../../api/types.js';
import { cn } from '../../lib/utils.js';

interface SuggestionChipsProps {
  onSelect: (text: string) => void;
}

const STATIC_CHIPS = ['Build a technical strategy', 'Trade like a famous investor', 'Build a custom index'] as const;

const STATIC_STYLE = cn(
  'rounded-full px-3.5 py-1.5 text-xs',
  'bg-bg-tertiary border border-border text-text-secondary',
  'hover:border-accent-primary hover:text-accent-primary',
  'transition-colors cursor-pointer',
);

const DYNAMIC_STYLE = cn(
  'rounded-full px-3.5 py-1.5 text-xs',
  'bg-accent-primary/10 border border-accent-primary/30 text-accent-primary',
  'hover:bg-accent-primary/20 hover:border-accent-primary/50',
  'transition-colors cursor-pointer',
);

function buildDynamicChips(snapshot: PortfolioSnapshot): string[] {
  const { positions, totalValue, sectorExposure } = snapshot;
  if (!positions.length || totalValue <= 0) return [];

  const chips: string[] = [];

  const weights = positions.map((p: Position) => ({
    symbol: p.symbol,
    weight: p.marketValue / totalValue,
  }));
  weights.sort((a, b) => b.weight - a.weight);

  const top = weights[0];
  if (top) {
    chips.push(`Alert me when ${top.symbol} drops 10%`);
  }

  const heaviest = sectorExposure.length ? [...sectorExposure].sort((a, b) => b.weight - a.weight)[0] : null;
  if (heaviest) {
    chips.push(`Watch for earnings on my ${heaviest.sector} positions`);
  }

  const concentrated = weights.find((w) => w.weight > 0.15);
  if (concentrated) {
    const thresholdPct = Math.min(100, Math.round(concentrated.weight * 100) + 5);
    chips.push(`Rebalance when ${concentrated.symbol} exceeds ${thresholdPct}%`);
  }

  return chips;
}

export function SuggestionChips({ onSelect }: SuggestionChipsProps) {
  const [portfolioResult] = usePortfolio();
  const snapshot = portfolioResult.data?.portfolio ?? null;

  const dynamicChips = useMemo(() => (snapshot ? buildDynamicChips(snapshot) : []), [snapshot]);

  return (
    <div className="flex flex-wrap gap-2 px-4 pb-3">
      {STATIC_CHIPS.map((text) => (
        <button key={text} type="button" className={STATIC_STYLE} onClick={() => onSelect(text)}>
          {text}
        </button>
      ))}
      {dynamicChips.map((text) => (
        <button key={text} type="button" className={DYNAMIC_STYLE} onClick={() => onSelect(text)}>
          {text}
        </button>
      ))}
    </div>
  );
}
