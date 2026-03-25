/**
 * SignalClustering — LLM-based fuzzy deduplication and causal linking pipeline.
 *
 * For each newly ingested signal:
 *   1. Find candidate signals from the archive sharing tickers within a 6-hour window.
 *   2. No candidates → generate summary and store enriched signal.
 *   3. Classify each candidate as SAME / RELATED / DIFFERENT.
 *      - SAME    → merge sources, bump version, regenerate summary.
 *      - RELATED → enrich new signal, link both in a SignalGroup.
 *      - DIFFERENT → try next candidate. If all differ → enrich independently.
 *   4. A semaphore caps concurrent LLM calls.
 */

import { randomUUID } from 'node:crypto';

import type { SignalArchive } from './archive.js';
import type { SignalGroupArchive } from './group-archive.js';
import type { SignalGroup } from './group-types.js';
import type { SummaryGenerator, SummaryResult } from './summary-generator.js';
import type { Signal } from './types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('signal-clustering');

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export type ClassificationResult = 'SAME' | 'RELATED' | 'DIFFERENT';

export interface ClassifyInput {
  existing: { title: string; type: string; tickers: string[]; time: string };
  incoming: { title: string; type: string; tickers: string[]; time: string };
}

export interface ClusteringOptions {
  archive: SignalArchive;
  groupArchive: SignalGroupArchive;
  /** LLM classification: returns SAME, RELATED, or DIFFERENT */
  classify: (input: ClassifyInput) => Promise<ClassificationResult>;
  /** Summary generator for tier1/tier2/sentiment/outputType */
  generator: SummaryGenerator;
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
   * Process newly ingested signals — fuzzy dedup + link related.
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
        // Write raw signal so it isn't lost — ingestor relies on us for all writes
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
  // Private: process a single signal
  // ---------------------------------------------------------------------------

  private async processOne(signal: Signal): Promise<void> {
    const tickers = signal.assets.map((a) => a.ticker);
    const sixHoursAgo = new Date(new Date(signal.publishedAt).getTime() - 6 * 60 * 60 * 1000).toISOString();

    const candidates = await this.options.archive.query({
      tickers,
      since: sixHoursAgo,
      until: signal.publishedAt,
      limit: 20,
    });

    // Filter: must share at least 1 ticker, must not be the signal itself
    const tickerSet = new Set(tickers);
    const filtered = candidates.filter((c) => c.id !== signal.id && c.assets.some((a) => tickerSet.has(a.ticker)));

    if (filtered.length === 0) {
      await this.enrichAndStore(signal);
      return;
    }

    // Sort by ticker overlap (most overlap first)
    const sorted = this.sortByOverlap(filtered, tickerSet);

    for (const candidate of sorted) {
      const result = await this.classifyWithSemaphore(candidate, signal);

      if (result === 'SAME') {
        await this.mergeSame(candidate, signal);
        return;
      }

      if (result === 'RELATED') {
        await this.linkRelated(candidate, signal);
        return;
      }

      // DIFFERENT — try next candidate
    }

    // All candidates are DIFFERENT — enrich independently
    await this.enrichAndStore(signal);
  }

  // ---------------------------------------------------------------------------
  // Private: classify with semaphore
  // ---------------------------------------------------------------------------

  private async classifyWithSemaphore(existing: Signal, incoming: Signal): Promise<ClassificationResult> {
    await this.semaphore.acquire();
    try {
      return await this.options.classify({
        existing: {
          title: existing.title,
          type: existing.type,
          tickers: existing.assets.map((a) => a.ticker),
          time: existing.publishedAt,
        },
        incoming: {
          title: incoming.title,
          type: incoming.type,
          tickers: incoming.assets.map((a) => a.ticker),
          time: incoming.publishedAt,
        },
      });
    } finally {
      this.semaphore.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Private: SAME — merge source into existing signal, bump version
  // ---------------------------------------------------------------------------

  private async mergeSame(existing: Signal, incoming: Signal): Promise<void> {
    // Merge sources from incoming into existing (deduplicate by source id)
    const existingSourceIds = new Set(existing.sources.map((s) => s.id));
    const newSources = incoming.sources.filter((s) => !existingSourceIds.has(s.id));

    const merged: Signal = {
      ...existing,
      sources: [...existing.sources, ...newSources],
      version: (existing.version ?? 1) + 1,
    };

    const summary = await this.generateWithSemaphore(merged);
    const enriched: Signal = { ...merged, ...summary };

    await this.options.archive.appendUpdate(enriched);

    logger.debug('SignalClustering: merged duplicate signal', {
      existingId: existing.id,
      incomingId: incoming.id,
      newVersion: enriched.version,
    });
  }

  // ---------------------------------------------------------------------------
  // Private: RELATED — enrich new signal and create/update a SignalGroup
  // ---------------------------------------------------------------------------

  private async linkRelated(existing: Signal, incoming: Signal): Promise<void> {
    // Generate summary for the incoming signal (without storing yet)
    const summary = await this.generateWithSemaphore(incoming);
    const now = new Date().toISOString();

    // Determine if either signal already belongs to a group
    const existingGroupId = existing.groupId ?? null;
    const incomingGroupId = incoming.groupId ?? null;

    const resolvedGroupId = existingGroupId ?? incomingGroupId ?? `grp-${randomUUID()}`;

    // Build group summary from tier1 values
    const existingTier1 = existing.tier1 ?? existing.title;
    const incomingTier1 = summary.tier1;
    const groupSummary = `${existingTier1} → ${incomingTier1}`;

    // Collect all tickers for the group
    const allTickers = Array.from(
      new Set([...existing.assets.map((a) => a.ticker), ...incoming.assets.map((a) => a.ticker)]),
    );

    // Try to add to an existing group (either signal may already belong to one)
    const knownGroupId = existingGroupId ?? incomingGroupId;
    if (knownGroupId) {
      const group = await this.options.groupArchive.getById(knownGroupId);
      if (group) {
        const updatedGroup: SignalGroup = {
          ...group,
          signalIds: Array.from(new Set([...group.signalIds, existing.id, incoming.id])),
          tickers: Array.from(new Set([...group.tickers, ...allTickers])),
          summary: groupSummary,
          lastEventAt: incoming.publishedAt > group.lastEventAt ? incoming.publishedAt : group.lastEventAt,
          version: group.version + 1,
          updatedAt: now,
        };
        await this.options.groupArchive.appendUpdate(updatedGroup);

        // Store incoming signal enriched + with groupId
        const enrichedIncoming: Signal = {
          ...incoming,
          ...summary,
          groupId: knownGroupId,
          version: (incoming.version ?? 1) + 1,
        };
        await this.options.archive.appendUpdate(enrichedIncoming);

        // Ensure existing signal also has the groupId
        if (!existingGroupId) {
          const updatedExisting: Signal = {
            ...existing,
            groupId: knownGroupId,
            version: (existing.version ?? 1) + 1,
          };
          await this.options.archive.appendUpdate(updatedExisting);
        }

        logger.debug('SignalClustering: added signal to existing group', {
          groupId: knownGroupId,
          incomingId: incoming.id,
        });
        return;
      }
    }

    // Create a new group
    const group: SignalGroup = {
      id: resolvedGroupId,
      signalIds: [existing.id, incoming.id],
      tickers: allTickers,
      summary: groupSummary,
      outputType: 'INSIGHT',
      firstEventAt: existing.publishedAt < incoming.publishedAt ? existing.publishedAt : incoming.publishedAt,
      lastEventAt: existing.publishedAt > incoming.publishedAt ? existing.publishedAt : incoming.publishedAt,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await this.options.groupArchive.append(group);

    // Update existing signal with groupId
    const updatedExisting: Signal = {
      ...existing,
      groupId: resolvedGroupId,
      version: (existing.version ?? 1) + 1,
    };
    await this.options.archive.appendUpdate(updatedExisting);

    // Store incoming signal enriched + with groupId in one write
    const enrichedIncoming: Signal = {
      ...incoming,
      ...summary,
      groupId: resolvedGroupId,
      version: (incoming.version ?? 1) + 1,
    };
    await this.options.archive.appendUpdate(enrichedIncoming);

    logger.debug('SignalClustering: created new SignalGroup', {
      groupId: resolvedGroupId,
      existingId: existing.id,
      incomingId: incoming.id,
    });
  }

  // ---------------------------------------------------------------------------
  // Private: enrich a signal, store it, and return the summary
  // ---------------------------------------------------------------------------

  private async enrichAndStore(signal: Signal): Promise<SummaryResult> {
    const summary = await this.generateWithSemaphore(signal);
    const enriched: Signal = {
      ...signal,
      ...summary,
      version: (signal.version ?? 1) + 1,
    };
    await this.options.archive.append(enriched);
    return summary;
  }

  // ---------------------------------------------------------------------------
  // Private: generate summary with semaphore
  // ---------------------------------------------------------------------------

  private async generateWithSemaphore(signal: Signal): Promise<SummaryResult> {
    await this.semaphore.acquire();
    try {
      return await this.options.generator.generate(signal);
    } finally {
      this.semaphore.release();
    }
  }

  // ---------------------------------------------------------------------------
  // Private: sort candidates by ticker overlap (most overlap first)
  // ---------------------------------------------------------------------------

  private sortByOverlap(candidates: Signal[], tickerSet: Set<string>): Signal[] {
    return [...candidates].sort((a, b) => {
      const overlapA = a.assets.filter((asset) => tickerSet.has(asset.ticker)).length;
      const overlapB = b.assets.filter((asset) => tickerSet.has(asset.ticker)).length;
      return overlapB - overlapA;
    });
  }
}
