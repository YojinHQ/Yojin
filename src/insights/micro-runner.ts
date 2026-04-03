/**
 * Micro Runner — orchestrates a single micro research cycle for one ticker.
 *
 * 1. Fetch Jintel signals for the ticker
 * 2. Run curation pipeline
 * 3. Build DataBrief
 * 4. Call micro-analyzer (Sonnet LLM)
 * 5. Save MicroInsight
 * 6. Create actions from assetActions
 */

import { randomUUID } from 'node:crypto';

import type { JintelClient } from '@yojinhq/jintel-client';

import { buildSingleBrief } from './data-gatherer.js';
import type { SingleBriefOptions } from './data-gatherer.js';
import { analyzeTicker } from './micro-analyzer.js';
import type { MicroInsightStore } from './micro-insight-store.js';
import type { MicroInsight, MicroInsightSource } from './micro-types.js';
import type { ActionStore } from '../actions/action-store.js';
import type { ProviderRouter } from '../ai-providers/router.js';
import type { EventLog } from '../core/event-log.js';
import type { NotificationBus } from '../core/notification-bus.js';
import { fetchJintelSignals } from '../jintel/signal-fetcher.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { SignalIngestor } from '../signals/ingestor.js';

const logger = createSubsystemLogger('micro-runner');

const ACTION_EXPIRY_HOURS = 24;

export interface MicroRunnerDeps {
  providerRouter: ProviderRouter;
  microInsightStore: MicroInsightStore;
  briefOptions: SingleBriefOptions;
  getJintelClient?: () => JintelClient | undefined;
  signalIngestor?: SignalIngestor;
  actionStore?: ActionStore;
  eventLog?: EventLog;
  notificationBus?: NotificationBus;
}

export interface MicroRunResult {
  insight: MicroInsight | null;
  signalsIngested: number;
  durationMs: number;
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

  // 2. Build DataBrief for this ticker
  const brief = await buildSingleBrief(ticker, deps.briefOptions);
  if (!brief) {
    logger.warn('Could not build brief — no snapshot', { symbol: ticker });
    return { insight: null, signalsIngested, durationMs: Date.now() - start };
  }

  // 3. AI analysis
  const insight = await analyzeTicker(brief, deps.providerRouter, { source });

  // 4. Save
  await deps.microInsightStore.save(insight);

  // 5. Create actions from asset observations
  if (deps.actionStore && insight.assetActions.length > 0) {
    const expiresAt = new Date(Date.now() + ACTION_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // Only push channel notifications for critical insights — extreme ratings
    // or high-conviction directional signals. All actions are still visible in the web UI.
    const isCritical =
      insight.rating === 'VERY_BULLISH' ||
      insight.rating === 'VERY_BEARISH' ||
      (insight.conviction >= 0.8 && insight.rating !== 'NEUTRAL');

    for (const actionText of insight.assetActions.filter((t) => t.trim().length > 0)) {
      const result = await deps.actionStore.create({
        id: randomUUID(),
        what: actionText,
        why: `Observation from ${ticker} research: ${insight.thesis.slice(0, 100)}`,
        source: `micro-observation: ${ticker}`,
        status: 'PENDING',
        expiresAt,
        createdAt: now,
      });
      if (result.success) {
        if (isCritical) {
          deps.notificationBus?.publish({ type: 'action.created', actionId: result.data.id, ticker });
        }
      } else {
        logger.warn('Failed to create action from micro observation', { symbol: ticker, error: result.error });
      }
    }
  }

  // 6. Event log
  if (deps.eventLog) {
    await deps.eventLog.append({
      type: 'system',
      data: {
        message: `Micro research for ${ticker}: ${insight.rating} (${(insight.conviction * 100).toFixed(0)}% conviction)`,
      },
    });
  }

  const durationMs = Date.now() - start;
  logger.info('Micro research complete', {
    symbol: ticker,
    rating: insight.rating,
    signalsIngested,
    durationMs,
  });

  return { insight, signalsIngested, durationMs };
}
