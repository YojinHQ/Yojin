import { Sun } from 'lucide-react';

interface BriefingStat {
  value: string;
  label: string;
}

interface MorningBriefingProps {
  date?: string;
  updatedAt?: string;
  stats?: BriefingStat[];
  onViewFull?: () => void;
}

export default function MorningBriefing({
  date = 'Friday, January 17',
  updatedAt = 'Updated 8:00 AM',
  stats = [
    { value: '3', label: 'ACTIONS REQUIRED' },
    { value: '2', label: 'STOCK ALERTS' },
    { value: '4', label: 'INSIGHTS' },
    { value: '58.2%', label: 'AVG MARGIN' },
  ],
  onViewFull,
}: MorningBriefingProps) {
  return (
    <div className="overflow-hidden rounded-xl bg-gradient-to-br from-accent-primary/80 to-accent-dark p-5 text-white">
      {/* Header row */}
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15">
            <Sun className="h-4 w-4" />
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-widest opacity-90">Morning Briefing</span>
        </div>
        {onViewFull && (
          <button
            onClick={onViewFull}
            className="cursor-pointer rounded-lg bg-white/15 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/25"
          >
            View Full Briefing
          </button>
        )}
      </div>

      {/* Date & time */}
      <div className="mb-5 ml-[42px]">
        <h3 className="font-headline text-lg">{date}</h3>
        <p className="mt-0.5 text-[11px] opacity-50">{updatedAt}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2.5">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-white/20 px-2 py-2.5 text-center">
            <div className="text-lg font-bold leading-tight">{stat.value}</div>
            <div className="mt-1 text-[9px] font-medium uppercase leading-tight tracking-wider opacity-50">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
