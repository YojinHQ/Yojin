import { cn } from '../../lib/utils';

interface TimePickerProps {
  value: string; // "HH:MM" in 24h format
  onChange: (time: string) => void;
  className?: string;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = ['00', '15', '30', '45'];

function parse24(time: string): { hour12: number; minute: string; period: 'AM' | 'PM' } {
  const [hStr, mStr] = time.split(':');
  let h = parseInt(hStr, 10);
  const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  // Snap minute to nearest quarter
  const m = parseInt(mStr, 10);
  const snapped = Math.round(m / 15) * 15;
  const minute = snapped === 60 ? '00' : String(snapped).padStart(2, '0');
  return { hour12: h, minute, period };
}

function to24(hour12: number, minute: string, period: 'AM' | 'PM'): string {
  let h = hour12;
  if (period === 'AM' && h === 12) h = 0;
  else if (period === 'PM' && h !== 12) h += 12;
  return `${String(h).padStart(2, '0')}:${minute}`;
}

const selectClass =
  'appearance-none rounded-lg border border-border bg-bg-card px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent-primary focus:ring-2 focus:ring-accent-primary/30 cursor-pointer';

export function TimePicker({ value, onChange, className }: TimePickerProps) {
  const { hour12, minute, period } = parse24(value);

  const handleHour = (h: number) => onChange(to24(h, minute, period));
  const handleMinute = (m: string) => onChange(to24(hour12, m, period));
  const handlePeriod = (p: 'AM' | 'PM') => onChange(to24(hour12, minute, p));

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Hour */}
      <select value={hour12} onChange={(e) => handleHour(Number(e.target.value))} className={selectClass}>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>

      <span className="text-text-muted">:</span>

      {/* Minute */}
      <select value={minute} onChange={(e) => handleMinute(e.target.value)} className={selectClass}>
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      {/* AM/PM */}
      <div className="flex rounded-lg border border-border bg-bg-tertiary/50 p-0.5">
        {(['AM', 'PM'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => handlePeriod(p)}
            className={cn(
              'cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              period === p
                ? 'border border-border bg-bg-card text-text-primary'
                : 'border border-transparent text-text-muted hover:bg-bg-hover/50 hover:text-text-secondary',
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
