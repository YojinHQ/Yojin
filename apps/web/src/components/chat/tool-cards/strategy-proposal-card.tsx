interface StrategyProposalCardProps {
  name?: string;
  category?: string;
  triggerCount?: number;
}

export function StrategyProposalCard({ name, category, triggerCount }: StrategyProposalCardProps) {
  return (
    <div className="rounded-xl border border-accent-primary/30 bg-accent-primary/5 px-5 py-3 flex items-center gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-primary/20 text-accent-primary">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.663 17h4.673M12 3v1m6.364 1.636-.707.707M21 12h-1M4 12H3m3.343-5.657-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547Z"
          />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary truncate">Strategy proposed{name ? `: ${name}` : ''}</p>
        <p className="text-xs text-text-muted">
          {[category, triggerCount !== undefined ? `${triggerCount} trigger${triggerCount !== 1 ? 's' : ''}` : null]
            .filter(Boolean)
            .join(' · ') || 'See form panel on the right'}
        </p>
      </div>
    </div>
  );
}
