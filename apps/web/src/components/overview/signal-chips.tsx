import { useNavigate } from 'react-router';

import { safeHref } from '../../lib/utils';

export interface SignalMapEntry {
  title: string;
  url: string | null;
  sourceCount?: number;
}

export interface ResolvedSignal {
  signalId: string;
  title: string;
  url: string | null;
  sourceCount?: number;
}

type SignalChipsProps = {
  navigate: ReturnType<typeof useNavigate>;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
} & (
  | { signalIds: string[]; signalMap: Map<string, SignalMapEntry>; signals?: never }
  | { signals: ResolvedSignal[]; signalIds?: never; signalMap?: never }
);

export function SignalChips(props: SignalChipsProps) {
  const { navigate, className, onClick } = props;

  const resolved =
    'signals' in props && props.signals
      ? props.signals.map((s) => ({ id: s.signalId, title: s.title, url: s.url, sourceCount: s.sourceCount }))
      : (props.signalIds ?? [])
          .map((id) => {
            const entry = (props.signalMap ?? new Map<string, SignalMapEntry>()).get(id);
            return { id, title: entry?.title, url: entry?.url ?? null, sourceCount: entry?.sourceCount };
          })
          .filter(
            (s): s is { id: string; title: string; url: string | null; sourceCount: number | undefined } => !!s.title,
          );

  if (resolved.length === 0) return null;

  return (
    <div className={className ?? 'mt-1 flex flex-wrap gap-1'}>
      {resolved.map((sig) => {
        const fallback = `/signals?highlight=${sig.id}`;
        const href = safeHref(sig.url, fallback);
        const isExternal = href !== fallback;
        return (
          <a
            key={sig.id}
            href={href}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
            onClick={(e) => {
              onClick?.(e);
              if (!isExternal) {
                e.preventDefault();
                navigate(fallback);
              }
            }}
            className="inline-flex items-center gap-1 rounded bg-bg-secondary px-1.5 py-0.5 text-[11px] text-accent-primary transition-colors hover:bg-accent-primary/10"
            title={sig.title}
          >
            <svg
              className="h-2.5 w-2.5 flex-shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
              />
            </svg>
            <span className="max-w-[120px] truncate">{sig.title}</span>
            {sig.sourceCount != null && sig.sourceCount > 1 && (
              <span className="ml-1 text-[10px] text-text-muted">×{sig.sourceCount}</span>
            )}
          </a>
        );
      })}
    </div>
  );
}
