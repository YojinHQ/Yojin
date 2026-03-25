interface CardEmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/**
 * Lightweight empty state for dashboard cards.
 * Centered layout: icon → title → description → optional action.
 */
export function CardEmptyState({ icon, title, description, action }: CardEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-5 pb-5 text-center">
      <div className="mb-1 text-text-muted/30">{icon}</div>
      <p className="text-xs font-medium text-text-muted">{title}</p>
      {description && <p className="max-w-[240px] text-2xs leading-relaxed text-text-muted/60">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
