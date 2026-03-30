interface CardEmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/**
 * Lightweight empty state for dashboard cards.
 * When used inside CardBlurGate, the blur gate provides the card container.
 */
export function CardEmptyState({ icon, title, description, action }: CardEmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2.5 text-center">
      <div className="mb-0.5 text-text-muted/40">{icon}</div>
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {description && <p className="text-xs leading-relaxed text-text-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
