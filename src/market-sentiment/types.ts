/**
 * Market Sentiment Baseline — types for tracking index ETF social sentiment
 * over time to establish what "normal" looks like.
 *
 * Once enough data accumulates (~30 days), these baselines enable z-score
 * computation for a Market Sentiment Regime detector (risk-on / risk-off / divergent).
 */

import { z } from 'zod';

/** Tickers treated as broad market indices for sentiment regime detection. */
export const INDEX_TICKERS = ['SPY', 'QQQ', 'DIA', 'IWM'] as const;
export type IndexTicker = (typeof INDEX_TICKERS)[number];

export const INDEX_TICKER_SET: ReadonlySet<string> = new Set(INDEX_TICKERS);

/** A single daily sentiment snapshot for one index ticker. */
export const SentimentSnapshotSchema = z.object({
  ticker: z.string().min(1),
  date: z.string().min(1), // YYYY-MM-DD
  timestamp: z.string().datetime(),
  rank: z.number(),
  mentions: z.number(),
  mentions24hAgo: z.number(),
  upvotes: z.number(),
  mentionMomentum: z.number().nullable(), // (mentions - mentions24hAgo) / mentions24hAgo
});
export type SentimentSnapshot = z.infer<typeof SentimentSnapshotSchema>;

/** Rolling stats computed from accumulated snapshots. */
export interface SentimentBaselineStats {
  ticker: string;
  /** Number of daily observations in the window. */
  dataPoints: number;
  /** Rolling mean of daily mention counts. */
  mentionsMean: number;
  /** Rolling standard deviation of daily mention counts. */
  mentionsStdDev: number;
  /** Rolling mean of mentionMomentum (fractional change). */
  momentumMean: number;
  /** Rolling standard deviation of mentionMomentum. */
  momentumStdDev: number;
  /** Rolling mean of upvotes. */
  upvotesMean: number;
  /** Mean upvote/mention ratio. */
  convictionMean: number;
}

/** Minimum days of data required before computing meaningful z-scores. */
export const MIN_BASELINE_DAYS = 14;
