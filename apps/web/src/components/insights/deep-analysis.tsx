/**
 * DeepAnalysis — on-demand deep-dive analysis for a single position.
 *
 * Triggered by a button in the PositionSignalCard expanded section.
 * Streams rich markdown analysis via GraphQL subscription.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Markdown from 'react-markdown';
import { useMutation, useSubscription } from 'urql';
import { DEEP_ANALYZE_POSITION_MUTATION, ON_DEEP_ANALYSIS_SUBSCRIPTION } from '../../api/documents';
import type { DeepAnalyzePositionMutationResult, OnDeepAnalysisSubscriptionResult } from '../../api/types';
import Spinner from '../common/spinner';

interface DeepAnalysisProps {
  symbol: string;
  insightReportId: string;
}

/** Accumulated state from subscription events, built purely in the reducer. */
interface AccumulatedAnalysis {
  text: string;
  phase: 'streaming' | 'complete' | 'error';
  error?: string;
}

export function DeepAnalysis({ symbol, insightReportId }: DeepAnalysisProps) {
  // `runId` increments on each trigger — 0 means idle, >0 means active/done.
  // The subscription pauses when the reducer reaches a terminal phase.
  const [runId, setRunId] = useState(0);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Accumulate subscription events purely in the reducer — no setState in effects.
  const [subscriptionResult] = useSubscription<OnDeepAnalysisSubscriptionResult, AccumulatedAnalysis>(
    {
      query: ON_DEEP_ANALYSIS_SUBSCRIPTION,
      variables: { symbol },
      pause: runId === 0,
    },
    (prev, data) => {
      const event = data.onDeepAnalysis;
      if (event.type === 'TEXT_DELTA' && event.delta) {
        return { text: (prev?.text ?? '') + event.delta, phase: 'streaming' };
      }
      if (event.type === 'COMPLETE' && event.content) {
        return { text: event.content, phase: 'complete' };
      }
      if (event.type === 'ERROR') {
        return { text: prev?.text ?? '', phase: 'error', error: event.error ?? 'Analysis failed' };
      }
      return prev ?? { text: '', phase: 'streaming' };
    },
  );

  const accumulated = subscriptionResult.data;

  // Derive display state from accumulated subscription data + local flags.
  const state = useMemo<'idle' | 'loading' | 'streaming' | 'complete' | 'error'>(() => {
    if (mutationError) return 'error';
    if (runId === 0) return 'idle';
    if (!accumulated) return 'loading';
    return accumulated.phase;
  }, [runId, accumulated, mutationError]);

  const displayText = accumulated?.text ?? '';
  const displayError = mutationError ?? accumulated?.error ?? null;

  // Auto-scroll during streaming.
  useEffect(() => {
    if (state === 'streaming' && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [displayText, state]);

  const [, executeMutation] = useMutation<DeepAnalyzePositionMutationResult>(DEEP_ANALYZE_POSITION_MUTATION);

  const handleAnalyze = useCallback(async () => {
    setMutationError(null);
    setRunId((id) => id + 1);

    const result = await executeMutation({ symbol, insightReportId });
    if (result.error) {
      setMutationError(result.error.message);
      setRunId(0);
    }
  }, [symbol, insightReportId, executeMutation]);

  if (state === 'idle') {
    return (
      <button
        type="button"
        onClick={handleAnalyze}
        className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-accent-primary transition-colors hover:bg-bg-hover cursor-pointer"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z"
          />
        </svg>
        Deep Analysis
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Deep Analysis</h4>
        {state === 'complete' && (
          <button
            type="button"
            onClick={handleAnalyze}
            className="text-2xs text-text-muted hover:text-text-secondary cursor-pointer"
            aria-label="Refresh deep analysis"
          >
            Refresh
          </button>
        )}
      </div>

      {state === 'loading' && (
        <div className="flex items-center gap-2 py-4">
          <Spinner size="sm" />
          <span className="text-xs text-text-muted">Analyzing {symbol}...</span>
        </div>
      )}

      {(state === 'streaming' || state === 'complete') && (
        <div ref={containerRef} className="max-h-[500px] overflow-y-auto rounded-lg bg-bg-secondary p-4">
          <div className="prose prose-sm max-w-none prose-headings:text-text-primary prose-headings:mb-2 prose-headings:mt-4 prose-headings:text-sm prose-p:text-text-secondary prose-p:my-2 prose-p:text-xs prose-p:leading-relaxed prose-li:text-text-secondary prose-li:text-xs prose-li:my-0.5 prose-strong:text-text-primary prose-ul:my-2 prose-ol:my-2">
            <Markdown>{displayText}</Markdown>
          </div>
          {state === 'streaming' && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-primary" />
              <span className="text-2xs text-text-muted">Analyzing...</span>
            </div>
          )}
        </div>
      )}

      {state === 'error' && (
        <div className="rounded-lg bg-error/10 p-3">
          <p className="text-xs text-error">{displayError}</p>
          <button
            type="button"
            onClick={handleAnalyze}
            className="mt-2 text-xs text-accent-primary hover:underline cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
