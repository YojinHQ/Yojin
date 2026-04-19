/**
 * Micro Runner — orchestrates a single micro research cycle for one ticker.
 *
 * 1. Fetch Jintel signals for the ticker
 * 2. Run curation pipeline
 * 3. Build DataBrief
 * 4. Call micro-analyzer (Sonnet LLM)
 * 5. Save MicroInsight
 */

import type { Entity, JintelClient } from '@yojinhq/jintel-client';

import { buildSingleBriefEnriched, fetchAndMergeEntityExtras } from './data-gatherer.js';
import type { SingleBriefOptions } from './data-gatherer.js';
import { analyzeTicker } from './micro-analyzer.js';
import type { MicroInsightStore } from './micro-insight-store.js';
import type { MicroInsight, MicroInsightSource } from './micro-types.js';
import { evaluateTriggers, unionFields } from './triggers.js';
import type { TriggerHit } from './triggers.js';
import type { ProviderRouter } from '../ai-providers/router.js';
import type { EventLog } from '../core/event-log.js';
import { fetchJintelSignals } from '../jintel/signal-fetcher.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { SignalIngestor } from '../signals/ingestor.js';
import type { Signal } from '../signals/types.js';

const logger = createSubsystemLogger('micro-runner');

export interface MicroRunnerDeps {
  providerRouter: ProviderRouter;
  microInsightStore: MicroInsightStore;
  briefOptions: SingleBriefOptions;
  getJintelClient?: () => JintelClient | undefined;
  signalIngestor?: SignalIngestor;
  eventLog?: EventLog;
  /**
   * When false, skip the LLM analyzer call but still enrich + return the Entity
   * and signals so the caller can evaluate strategy triggers. Defaults to true.
   * Used by the micro flow to run trigger evaluation on the 5-min cadence without
   * spending an LLM call every time.
   */
  runLlm?: boolean;
}

export interface MicroRunResult {
  insight: MicroInsight | null;
  signalsIngested: number;
  durationMs: number;
  /** Raw Jintel Entity for per-asset strategy evaluation (null if Jintel unavailable). */
  entity?: Entity | null;
  /** Curated signals used in analysis — for per-asset strategy evaluation. */
  signals?: Signal[];
}

/**
 * Run micro research for a single ticker.
 */
export async function runMicroResearch(
  symbol: string,
  source: MicroInsightSource,
  deps: MicroRunnerDeps,
): Promise<MicroRunResult> {
  const start = Date.now();
  const ticker = symbol.toUpperCase();

  logger.info('Micro research started', { symbol: ticker, source });

  // 1. Fetch Jintel signals for this ticker
  let signalsIngested = 0;
  const jintelClient = deps.getJintelClient?.();
  if (jintelClient && deps.signalIngestor) {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = await fetchJintelSignals(jintelClient, deps.signalIngestor, [ticker], { since });
    signalsIngested = result.ingested;
  }

  // 2. Build DataBrief for this ticker (enriched: includes raw Entity + signals for strategy evaluation)
  const enriched = await buildSingleBriefEnriched(ticker, deps.briefOptions);
  if (!enriched) {
    logger.warn('Could not build brief — no snapshot', { symbol: ticker });
    return { insight: null, signalsIngested, durationMs: Date.now() - start };
  }
  let { brief } = enriched;
  const { signals: curatedSignals } = enriched;
  let entity = enriched.entity;

  // 2a. Progressive enrichment — evaluate Phase-1 triggers and, if any fire with
  //     extra fields, fetch those sub-graphs, merge them onto the base entity,
  //     and rebuild the brief so the analyzer actually sees the fetched fields.
  //     Trigger reasons are also forwarded to the LLM as focus hints.
  const hits: TriggerHit[] = evaluateTriggers(brief, entity);
  const extras = unionFields(hits);
  if (extras.length > 0 && jintelClient) {
    const before = entity;
    entity = await fetchAndMergeEntityExtras(jintelClient, ticker, entity, extras);
    const merged = entity !== before;
    if (merged) {
      brief = enriched.rebuildWithEntity(entity);
    }
    logger.info('Tier-1 enrichment fetched', {
      symbol: ticker,
      triggers: hits.map((h) => h.id),
      extras,
      merged,
    });
  } else if (hits.length > 0) {
    logger.debug('Triggers fired (focus-only, no extra fetch)', {
      symbol: ticker,
      triggers: hits.map((h) => h.id),
    });
  }
  const triggerReasons = hits.map((h) => `[${h.id}] ${h.reason}`);

  // 3. AI analysis — wrap so entity/signals are still returned on LLM failure.
  //    When runLlm is false, we skip the LLM entirely and let the caller run
  //    strategy triggers against the already-enriched entity.
  let insight: MicroInsight | null = null;
  if (deps.runLlm !== false) {
    try {
      insight = await analyzeTicker(brief, deps.providerRouter, { source, triggerReasons });

      // 4. Save
      await deps.microInsightStore.save(insight);

      // 5. Event log
      if (deps.eventLog) {
        await deps.eventLog.append({
          type: 'system',
          data: {
            message: `Micro research for ${ticker}: ${insight.rating} (${(insight.conviction * 100).toFixed(0)}% conviction)`,
          },
        });
      }

      logger.info('Micro research complete', {
        symbol: ticker,
        rating: insight.rating,
        signalsIngested,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      logger.warn('Micro research LLM analysis failed — entity still available for strategy evaluation', {
        symbol: ticker,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    logger.debug('Micro research ran without LLM (trigger-only enrichment)', {
      symbol: ticker,
      signalsIngested,
      durationMs: Date.now() - start,
    });
  }

  const durationMs = Date.now() - start;
  return { insight, signalsIngested, durationMs, entity, signals: curatedSignals };
}
