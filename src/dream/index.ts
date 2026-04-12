/**
 * Dream module — background data consolidation for Yojin.
 *
 * Periodically cleans signal data, detects stale insights, and re-ranks
 * relevance so the user only sees what actually matters.
 */

export { DreamRunner } from './dream-runner.js';
export type { DreamRunnerDeps } from './dream-runner.js';
export { DreamStore } from './dream-store.js';
export { runSignalCleanup } from './signal-cleanup.js';
export type { SignalCleanupDeps } from './signal-cleanup.js';
export { runInsightFreshness } from './insight-freshness.js';
export type { InsightFreshnessDeps } from './insight-freshness.js';
export { runRelevanceReranking } from './relevance-reranking.js';
export type { RelevanceRerankDeps } from './relevance-reranking.js';
export { DEFAULT_DREAM_CONFIG, DreamConfigSchema, DreamLogSchema } from './types.js';
export type {
  DreamConfig,
  DreamLog,
  SignalCleanupResult,
  InsightFreshnessResult,
  RelevanceRerankResult,
} from './types.js';
