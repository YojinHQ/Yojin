import { useMemo } from 'react';

import { usePortfolio } from '../../api/hooks/index.js';
import type { PortfolioSnapshot } from '../../api/types.js';
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
  const { positions, sectorExposure } = snapshot;
  if (!positions.length) return [];

  const chips: string[] = [];

  // Use positions sorted by marketValue (pre-computed by backend) to find top holding
  const sorted = [...positions].sort((a, b) => b.marketValue - a.marketValue);
  const top = sorted[0];
  if (top) {
    chips.push(`Alert me when ${top.symbol} drops 10%`);
  }

  // Use sectorExposure (weights pre-computed by backend) for sector-based suggestion
  const heaviest = sectorExposure.length ? [...sectorExposure].sort((a, b) => b.weight - a.weight)[0] : null;
  if (heaviest) {
    chips.push(`Watch for earnings on my ${heaviest.sector} positions`);
  }

  // Use sectorExposure weight (from backend) to detect concentration
  const concentratedSector = sectorExposure.find((s) => s.weight > 15);
  if (concentratedSector && top) {
    chips.push(`Rebalance when ${top.symbol} exceeds 20%`);
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
