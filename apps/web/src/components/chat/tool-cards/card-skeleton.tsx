import { cn } from '../../../lib/utils';

interface CardSkeletonProps {
  tool: string;
  className?: string;
}

/** A solid skeleton "bone" — the shimmer overlay on the parent gives it life. */
function Bone({ className }: { className?: string }) {
  return <div className={cn('rounded bg-bg-secondary', className)} />;
}

function SkeletonHeader() {
  return (
    <div className="flex items-center justify-between px-6 pt-5 pb-4">
      <div className="flex items-center gap-2.5">
        <div className="h-7 w-7 rounded-lg bg-accent-glow" />
        <Bone className="h-4 w-36" />
      </div>
      <Bone className="h-5 w-14 rounded-md border border-border/40" />
    </div>
  );
}

function SkeletonBody() {
  return (
    <div className="space-y-2 px-6 pb-5">
      <Bone className="h-3.5 w-full" />
      <Bone className="h-3.5 w-3/4" />
    </div>
  );
}

function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 px-6 pb-5" style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2.5 rounded-xl border border-border bg-bg-secondary px-4 py-4 text-center">
          <Bone className="mx-auto h-5 w-16 bg-bg-hover" />
          <Bone className="mx-auto h-2.5 w-14 bg-bg-hover" />
        </div>
      ))}
    </div>
  );
}

function SkeletonTableRow({ cols }: { cols: number }) {
  return (
    <div className="flex items-center border-b border-border/30 py-3 last:border-0">
      <div className="flex items-center gap-2.5">
        <Bone className="h-8 w-8 shrink-0 rounded-full" />
        <Bone className="h-3.5 w-14" />
      </div>
      {Array.from({ length: cols - 1 }, (_, j) => (
        <Bone key={j} className="ml-auto h-3.5 w-16" />
      ))}
    </div>
  );
}

function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="px-6 pb-5">
      {/* Column headers */}
      <div className="flex border-b border-border pb-3">
        <Bone className="h-2 w-16" />
        {Array.from({ length: cols - 1 }, (_, i) => (
          <Bone key={i} className="ml-auto h-2 w-12" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonTableRow key={i} cols={cols} />
      ))}
    </div>
  );
}

function SkeletonSectionLabel() {
  return (
    <div className="px-6 pt-4 pb-3">
      <Bone className="h-2.5 w-32" />
    </div>
  );
}

function SkeletonProgressBars({ count = 4 }: { count?: number }) {
  const widths = ['w-[70%]', 'w-[45%]', 'w-[30%]', 'w-[18%]', 'w-[12%]'];
  return (
    <div className="space-y-4 px-6 pb-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="flex justify-between">
            <Bone className="h-3 w-20" />
            <Bone className="h-3 w-12" />
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-bg-secondary">
            <Bone className={cn('h-full rounded-full bg-bg-hover', widths[i % widths.length])} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SkeletonAlertRow() {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-bg-secondary px-4 py-3">
      <Bone className="h-4 w-4 shrink-0 rounded bg-bg-hover" />
      <Bone className="h-3.5 w-48 bg-bg-hover" />
    </div>
  );
}

function SkeletonHeadlineRow() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-bg-secondary px-4 py-3">
      <Bone className="mt-0.5 h-5 w-5 shrink-0 rounded bg-bg-hover" />
      <div className="space-y-1.5">
        <Bone className="h-3.5 w-52 bg-bg-hover" />
        <Bone className="h-2.5 w-24 bg-bg-hover" />
      </div>
    </div>
  );
}

function SkeletonActions({ count = 2 }: { count?: number }) {
  const widths = ['w-28', 'w-22', 'w-20'];
  return (
    <div className="px-6 pb-6">
      <Bone className="mb-3 h-2.5 w-32" />
      <div className="flex gap-2">
        {Array.from({ length: count }, (_, i) => (
          <Bone key={i} className={cn('h-7 rounded-full bg-bg-tertiary', widths[i % widths.length])} />
        ))}
      </div>
    </div>
  );
}

/**
 * Card-shaped skeleton loading placeholder.
 *
 * Uses the same RichCard visual language (rounded-xl, border, bg-bg-card, stats
 * boxes, table rows, etc.) so the skeleton closely matches the incoming card and
 * the transition from skeleton to real data feels seamless.
 *
 * A single shimmer gradient sweeps across the entire card for a premium feel.
 */
export default function CardSkeleton({ tool, className }: CardSkeletonProps) {
  const isAllocation = tool === 'allocation';
  const isMorningBriefing = tool === 'morning-briefing';
  const isPositionsList = tool === 'positions-list';
  const hasBody = !isPositionsList;

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-border bg-bg-card', className)}>
      {/* Shimmer overlay — single gradient sweep across the entire card */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />

      <SkeletonHeader />
      {hasBody && <SkeletonBody />}
      {!isAllocation && <SkeletonStats count={isPositionsList ? 2 : 4} />}

      {isAllocation ? (
        <>
          <SkeletonSectionLabel />
          <SkeletonProgressBars />
        </>
      ) : (
        <>
          <SkeletonSectionLabel />
          <SkeletonTable rows={5} cols={isPositionsList ? 3 : 4} />
        </>
      )}

      {isMorningBriefing && (
        <>
          <SkeletonSectionLabel />
          <div className="space-y-2 px-6 pb-5">
            <SkeletonAlertRow />
          </div>
          <SkeletonSectionLabel />
          <div className="space-y-2 px-6 pb-5">
            <SkeletonHeadlineRow />
            <SkeletonHeadlineRow />
            <SkeletonHeadlineRow />
          </div>
        </>
      )}

      <SkeletonActions count={isMorningBriefing ? 3 : 2} />
    </div>
  );
}
