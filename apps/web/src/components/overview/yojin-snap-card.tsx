import { DashboardCard } from '../common/dashboard-card';

export default function YojinSnapCard() {
  return (
    <DashboardCard
      title="Yojin Snap"
      variant="feature"
      className="flex-1"
      headerAction={<span className="rounded-md bg-bg-tertiary px-2.5 py-1 text-2xs text-text-muted">Coming soon</span>}
    >
      <div className="flex flex-1 items-center justify-center px-5 pb-5">
        <p className="max-w-xs text-center text-sm leading-relaxed text-text-secondary">
          A live intelligence surface for a quick brief. It answers: &ldquo;Right now, where do I stand and what
          deserves my attention?&rdquo;
        </p>
      </div>
    </DashboardCard>
  );
}
