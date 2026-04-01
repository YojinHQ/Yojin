/**
 * SignalClustering — deduplication and causal linking pipeline.
 *
 * Uses the QualityAgent (single LLM gate) for enrichment and duplicate detection.
 * No separate classify LLM call — the quality agent's verdict handles it:
 *   - verdict=DROP + dropReason=duplicate + duplicateOf → merge sources (SAME)
 *   - verdict=KEEP + same ticker+day as existing signal → link as RELATED
 *   - verdict=KEEP + no overlap → store independently
 *
 * A semaphore caps concurrent LLM calls.
 */

import { randomUUID } from 'node:crypto';

import type { SignalArchive } from './archive.js';
import type { SignalGroupArchive } from './group-archive.js';
import type { SignalGroup } from './group-types.js';
import type { QualityAgent, QualityVerdict } from './quality-agent.js';
import type { Signal } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('signal-clustering');

// ---------------------------------------------------------------------------
// Public interface (kept for backward compat — ClassifyInput/ClassificationResult
// are no longer used internally but may be referenced by tests or external code)
// ---------------------------------------------------------------------------

export type ClassificationResult = 'SAME' | 'RELATED' | 'DIFFERENT';

export interface ClassifyInput {
  existing: { title: string; type: string; tickers: string[]; time: string };
  incoming: { title: string; type: string; tickers: string[]; time: string };
}

export interface ClusteringOptions {
  archive: SignalArchive;
  groupArchive: SignalGroupArchive;
  /** Quality agent for enrichment and duplicate detection */
  qualityAgent: QualityAgent;
  /** Max concurrent LLM calls (default 5) */
  concurrencyLimit?: number;
}

// ---------------------------------------------------------------------------
// Semaphore
// ---------------------------------------------------------------------------

class Semaphore {
  private count: number;
  private readonly waiting: Array<() => void> = [];

  constructor(max: number) {
    this.count = max;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return;
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.count++;
    }
  }
}

// ---------------------------------------------------------------------------
// SignalClustering
// ---------------------------------------------------------------------------

export class SignalClustering {
  private readonly options: ClusteringOptions;
  private readonly semaphore: Semaphore;

  constructor(options: ClusteringOptions) {
    this.options = options;
    this.semaphore = new Semaphore(options.concurrencyLimit ?? 5);
  }

  /**
   * Process newly ingested signals — quality evaluation + dedup + store.
   * Fire-and-forget safe: errors are caught and logged, never thrown.
   */
  async processSignals(signals: Signal[]): Promise<void> {
    for (const signal of signals) {
      try {
        await this.processOne(signal);
      } catch (error) {
        logger.error('SignalClustering: failed to process signal, writing raw', {
          signalId: signal.id,
          error: error instanceof Error ? error.message : String(error),
        });
        try {
          await this.options.archive.append(signal);
        } catch (writeErr) {
          logger.error('SignalClustering: fallback write also failed', {
            signalId: signal.id,
            error: writeErr instanceof Error ? writeErr.message : String(writeErr),
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: process a single signal via quality agent
  // ---------------------------------------------------------------------------

  private async processOne(signal: Signal): Promise<void> {
    const tickers = signal.assets.map((a) => a.ticker);
    const sixHoursAgo = new Date(new Date(signal.publishedAt).getTime() - 6 * 60 * 60 * 1000).toISOString();

    // Fetch recent signals for context (duplicate detection + signal groups)
    const candidates = await this.options.archive.query({
      tickers,
      since: sixHoursAgo,
      until: signal.publishedAt,
      limit: 20,
    });

    const tickerSet = new Set(tickers);
    const recentSignals = candidates.filter((c) => c.id !== signal.id && c.assets.some((a) => tickerSet.has(a.ticker)));

    // Single LLM call — quality agent decides everything
    const verdict = await this.evaluateWithSemaphore(signal, recentSignals);

    if (verdict.verdict === 'DROP') {
      if (verdict.dropReason === 'duplicate' && verdict.duplicateOf) {
        // Merge sources into the existing signal instead of dropping entirely
        await this.mergeIntoExisting(signal, recentSignals, verdict.duplicateOf);
      } else {
        logger.info('Quality agent dropped signal via clustering', {
          signalId: signal.id,
          title: signal.title,
          reason: verdict.dropReason,
          qualityScore: verdict.qualityScore,
        });
      }
      return;
    }

    // KEEP — enrich and store
    const enriched: Signal = {
      ...signal,
      tier1: signal.tier1 ?? verdict.tier1,
      tier2: signal.tier2 ?? verdict.tier2,
      sentiment: verdict.sentiment,
      outputType: verdict.outputType,
      qualityScore: verdict.qualityScore,
      version: (signal.version ?? 1) + 1,
    };

    // Link as related if there are recent signals for the same ticker+day
    const day = signal.publishedAt.slice(0, 10);
    const sameDaySignal = recentSignals.find((c) => c.publishedAt.slice(0, 10) === day);
    if (sameDaySignal) {
      const allTickers = Array.from(
        new Set([...sameDaySignal.assets.map((a) => a.ticker), ...signal.assets.map((a) => a.ticker)]),
      );
      const now = new Date().toISOString();

      if (sameDaySignal.groupId) {
        // Add to existing group
        enriched.groupId = sameDaySignal.groupId;
        const group = await this.options.groupArchive.getById(sameDaySignal.groupId);
        if (group) {
          const updatedGroup: SignalGroup = {
            ...group,
            signalIds: Array.from(new Set([...group.signalIds, signal.id])),
            tickers: Array.from(new Set([...group.tickers, ...allTickers])),
            lastEventAt: signal.publishedAt > group.lastEventAt ? signal.publishedAt : group.lastEventAt,
            version: group.version + 1,
            updatedAt: now,
          };
          await this.options.groupArchive.appendUpdate(updatedGroup);
        }
      } else {
        // Create a new group linking both signals
        const groupId = `grp-${randomUUID()}`;
        enriched.groupId = groupId;

        const existingTier1 = sameDaySignal.tier1 ?? sameDaySignal.title;
        const incomingTier1 = enriched.tier1 ?? signal.title;

        const group: SignalGroup = {
          id: groupId,
          signalIds: [sameDaySignal.id, signal.id],
          tickers: allTickers,
          summary: `${existingTier1} → ${incomingTier1}`,
          outputType: 'INSIGHT',
          firstEventAt: sameDaySignal.publishedAt < signal.publishedAt ? sameDaySignal.publishedAt : signal.publishedAt,
          lastEventAt: sameDaySignal.publishedAt > signal.publishedAt ? sameDaySignal.publishedAt : signal.publishedAt,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        await this.options.groupArchive.append(group);

        // Update existing signal with groupId
        const updatedExisting: Signal = {
          ...sameDaySignal,
          groupId,
          version: (sameDaySignal.version ?? 1) + 1,
        };
        await this.options.archive.appendUpdate(updatedExisting);
      }
    }

    await this.options.archive.append(enriched);
  }

  // ---------------------------------------------------------------------------
  // Private: merge sources into existing signal (duplicate detected by quality agent)
  // ---------------------------------------------------------------------------

  private async mergeIntoExisting(incoming: Signal, candidates: Signal[], duplicateOfTitle: string): Promise<void> {
    // Find the existing signal by matching title/tier1
    const normalizedTarget = duplicateOfTitle.trim().toLowerCase();
    const existing = candidates.find(
      (c) => c.title.trim().toLowerCase() === normalizedTarget || c.tier1?.trim().toLowerCase() === normalizedTarget,
    );

    if (!existing) {
      // Can't find the target — store as-is rather than losing data
      await this.options.archive.append(incoming);
      return;
    }

    // Merge sources (deduplicate by source id)
    const existingSourceIds = new Set(existing.sources.map((s) => s.id));
    const newSources = incoming.sources.filter((s) => !existingSourceIds.has(s.id));
    if (newSources.length === 0) return; // nothing new to merge

    const merged: Signal = {
      ...existing,
      sources: [...existing.sources, ...newSources],
      version: (existing.version ?? 1) + 1,
    };

    await this.options.archive.appendUpdate(merged);

    logger.debug('SignalClustering: merged duplicate sources', {
      existingId: existing.id,
      incomingId: incoming.id,
      newSourceCount: newSources.length,
    });
  }

  // ---------------------------------------------------------------------------
  // Private: evaluate with semaphore
  // ---------------------------------------------------------------------------

  private async evaluateWithSemaphore(signal: Signal, recentSignals: Signal[]): Promise<QualityVerdict> {
    const context = recentSignals.map((s) => ({
      title: s.title,
      tier1: s.tier1,
      publishedAt: s.publishedAt,
    }));
    await this.semaphore.acquire();
    try {
      return await this.options.qualityAgent.evaluate(signal, context);
    } finally {
      this.semaphore.release();
    }
  }
}
