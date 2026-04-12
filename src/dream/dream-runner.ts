/**
 * DreamRunner — orchestrates the background data consolidation pipeline.
 *
 * Three deterministic passes (no LLM calls):
 *   1. Signal cleanup — dismiss stale, dedup cross-source, learn noise patterns
 *   2. Insight freshness — detect stale theses, expire action items, graduate to profiles
 *   3. Relevance re-ranking — refresh convergence, portfolio-weight, flag snap regen
 *
 * Gated by a configurable time interval. Each run is logged to DreamStore.
 */

import { randomUUID } from 'node:crypto';

import { DreamStore } from './dream-store.js';
import { runInsightFreshness } from './insight-freshness.js';
import { runRelevanceReranking } from './relevance-reranking.js';
import { runSignalCleanup } from './signal-cleanup.js';
import type { DreamConfig, DreamLog } from './types.js';
import { DEFAULT_DREAM_CONFIG } from './types.js';
import type { InsightStore } from '../insights/insight-store.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';
import type { TickerProfileStore } from '../profiles/profile-store.js';
import type { SignalArchive } from '../signals/archive.js';
import type { AssessmentStore } from '../signals/curation/assessment-store.js';
import type { SnapStore } from '../snap/snap-store.js';

const logger = createSubsystemLogger('dream-runner');

export interface DreamRunnerDeps {
  signalArchive: SignalArchive;
  assessmentStore: AssessmentStore;
  insightStore: InsightStore;
  snapStore: SnapStore;
  profileStore: TickerProfileStore;
  snapshotStore: PortfolioSnapshotStore;
}

export class DreamRunner {
  private readonly store: DreamStore;
  private readonly deps: DreamRunnerDeps;
  private readonly config: DreamConfig;

  constructor(dataRoot: string, deps: DreamRunnerDeps, config?: Partial<DreamConfig>) {
    this.store = new DreamStore(dataRoot);
    this.deps = deps;
    this.config = { ...DEFAULT_DREAM_CONFIG, ...config };
  }

  /** Check whether enough time has passed since the last dream run. */
  async shouldRun(): Promise<boolean> {
    const lastRunAt = await this.store.getLastRunAt();
    const hoursSince = (Date.now() - lastRunAt) / 3_600_000;
    return hoursSince >= this.config.minIntervalHours;
  }

  /** Execute the full dream pipeline. Returns the log entry. */
  async run(): Promise<DreamLog> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    logger.info('Dream started');

    // Pass 1: Signal cleanup
    const signalCleanup = await runSignalCleanup(
      {
        signalArchive: this.deps.signalArchive,
        assessmentStore: this.deps.assessmentStore,
      },
      this.config,
    );

    // Pass 2: Insight freshness
    const insightFreshness = await runInsightFreshness(
      {
        insightStore: this.deps.insightStore,
        signalArchive: this.deps.signalArchive,
        snapStore: this.deps.snapStore,
        profileStore: this.deps.profileStore,
      },
      this.config,
    );

    // Pass 3: Relevance re-ranking
    const relevanceRerank = await runRelevanceReranking(
      {
        signalArchive: this.deps.signalArchive,
        snapshotStore: this.deps.snapshotStore,
      },
      this.config,
    );

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startMs;

    const log: DreamLog = {
      id: `dream-${randomUUID().slice(0, 8)}`,
      startedAt,
      completedAt,
      durationMs,
      signalCleanup,
      insightFreshness,
      relevanceRerank,
    };

    await this.store.save(log);

    logger.info('Dream completed', {
      durationMs,
      signalsDismissed: signalCleanup.dismissed + signalCleanup.duplicatesMarked,
      staleTheses: insightFreshness.staleTheses.length,
      snapRegenRecommended: relevanceRerank.snapRegenerated,
    });

    return log;
  }

  /** Read recent dream logs for display. */
  async getRecentLogs(limit = 5): Promise<DreamLog[]> {
    return this.store.getRecent(limit);
  }
}
