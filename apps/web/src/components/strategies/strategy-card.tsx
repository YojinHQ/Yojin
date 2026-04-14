import { formatStyle } from './types.js';
import type { Strategy, StrategyCategory } from './types.js';
import Badge from '../common/badge';
import type { BadgeVariant } from '../common/badge';
import { cn, formatShortDate } from '../../lib/utils';

const categoryVariant: Record<StrategyCategory, BadgeVariant> = {
  RISK: 'error',
  PORTFOLIO: 'warning',
  MARKET: 'market',
  RESEARCH: 'success',
};

interface StrategyCardProps {
  strategy: Strategy;
  onToggle?: (id: string, active: boolean) => void;
  onClick?: (strategy: Strategy) => void;
}

export default function StrategyCard({ strategy, onToggle, onClick }: StrategyCardProps) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(strategy)}
      className={cn(
        'bg-bg-card border border-border rounded-xl p-4 hover:border-accent-primary',
        'hover:shadow-[0_0_12px_var(--color-accent-glow)] transition-all',
        'flex flex-col justify-between min-h-[160px] cursor-pointer text-left w-full',
      )}
    >
      <div>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Badge
              variant={categoryVariant[strategy.category]}
              size="xs"
              outline
              className="rounded font-semibold tracking-wide uppercase"
            >
              {strategy.category}
            </Badge>
            {strategy.style && (
              <Badge variant="neutral" size="xs" className="rounded">
                {formatStyle(strategy.style)}
              </Badge>
            )}
          </div>

          <label className="relative inline-flex items-center" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={strategy.active}
              onChange={() => onToggle?.(strategy.id, !strategy.active)}
              className="sr-only peer"
              aria-label={`Toggle ${strategy.name} ${strategy.active ? 'off' : 'on'}`}
            />
            <div
              className={cn(
                'w-8 h-[18px] rounded-full transition-colors',
                'peer-checked:bg-accent-primary bg-bg-tertiary',
                'after:content-[""] after:absolute after:top-[2px] after:left-[2px]',
                'after:bg-white after:rounded-full after:h-[14px] after:w-[14px]',
                'after:transition-transform peer-checked:after:translate-x-[14px]',
              )}
            />
          </label>
        </div>

        <h3 className="text-text-primary font-semibold mt-2.5 text-sm leading-snug">{strategy.name}</h3>
        <p className="text-text-secondary text-xs mt-1 leading-relaxed line-clamp-2">{strategy.description}</p>
      </div>

      <div className="flex items-center gap-2 mt-4 pt-1">
        <span className="text-text-muted text-2xs">
          {strategy.createdBy} &bull; {formatShortDate(strategy.createdAt)}
        </span>
      </div>
    </button>
  );
}
