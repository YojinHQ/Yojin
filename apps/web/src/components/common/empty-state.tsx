interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-bg-card/50 px-6 py-16 text-center">
      {icon && <div className="mb-4 text-text-muted">{icon}</div>}
      <h3 className="mb-1 text-sm font-medium text-text-secondary">{title}</h3>
      <p className="mb-4 max-w-sm text-sm text-text-muted">{description}</p>
      {action}
    </div>
  );
}
