/**
 * Deep analysis resolvers — on-demand, single-position deep dive.
 *
 * The mutation fires a background deep analysis via the ProviderRouter.
 * Results stream to the frontend via the onDeepAnalysis subscription.
 */

import type { ProviderRouter } from '../../../ai-providers/router.js';
import type { DataGathererOptions } from '../../../insights/data-gatherer.js';
import { gatherDataBriefs } from '../../../insights/data-gatherer.js';
import { deepAnalyzePosition } from '../../../insights/deep-analyzer.js';
import type { InsightStore } from '../../../insights/insight-store.js';
import { createSubsystemLogger } from '../../../logging/logger.js';
import type { SignalArchive } from '../../../signals/archive.js';
import type { DeepAnalysisEvent } from '../pubsub.js';
import { pubsub } from '../pubsub.js';

const logger = createSubsystemLogger('deep-analysis-resolver');

// ---------------------------------------------------------------------------
// State — injected at startup
// ---------------------------------------------------------------------------

let insightStore: InsightStore | null = null;
let providerRouter: ProviderRouter | null = null;
let gathererOptions: DataGathererOptions | null = null;
let signalArchive: SignalArchive | null = null;

export function setDeepAnalysisDeps(deps: {
  insightStore: InsightStore;
  providerRouter: ProviderRouter;
  gathererOptions: DataGathererOptions;
  signalArchive: SignalArchive;
}): void {
  insightStore = deps.insightStore;
  providerRouter = deps.providerRouter;
  gathererOptions = deps.gathererOptions;
  signalArchive = deps.signalArchive;
}

// Track active analyses to prevent concurrent runs for the same symbol
const activeAnalyses = new Set<string>();

// ---------------------------------------------------------------------------
// Mutation: deepAnalyzePosition
// ---------------------------------------------------------------------------

export function deepAnalyzePositionMutation(
  _parent: unknown,
  args: { symbol: string; insightReportId: string },
): boolean {
  const { symbol, insightReportId } = args;

  if (!insightStore || !providerRouter || !gathererOptions) {
    throw new Error('Deep analysis not configured — missing dependencies');
  }

  if (activeAnalyses.has(symbol)) {
    // Already running for this symbol — the frontend can subscribe to in-progress events
    return true;
  }

  activeAnalyses.add(symbol);

  // Fire-and-forget: run analysis in background, stream via pubsub
  const router = providerRouter;
  const store = insightStore;
  const opts = gathererOptions;
  const archive = signalArchive;

  void (async () => {
    try {
      // 1. Look up the insight report to get the existing position insight
      const report = await store.getById(insightReportId);
      if (!report) {
        pubsub.publish(`deepAnalysis:${symbol}`, {
          type: 'ERROR',
          symbol,
          error: `Insight report ${insightReportId} not found`,
        } satisfies DeepAnalysisEvent);
        return;
      }

      const positionInsight = report.positions.find(
        (p) => p.symbol.split('-')[0].toUpperCase() === symbol.split('-')[0].toUpperCase(),
      );
      if (!positionInsight) {
        pubsub.publish(`deepAnalysis:${symbol}`, {
          type: 'ERROR',
          symbol,
          error: `Position ${symbol} not found in insight report`,
        } satisfies DeepAnalysisEvent);
        return;
      }

      // 2. Gather full data brief for this single position
      const result = await gatherDataBriefs(opts);
      const brief = result.briefs.find(
        (b) => b.symbol.split('-')[0].toUpperCase() === symbol.split('-')[0].toUpperCase(),
      );
      if (!brief) {
        pubsub.publish(`deepAnalysis:${symbol}`, {
          type: 'ERROR',
          symbol,
          error: `Could not gather data for ${symbol} — position may no longer be in portfolio`,
        } satisfies DeepAnalysisEvent);
        return;
      }

      // 3. Fetch full signal objects for this position (includes content, metadata.link)
      const signalIds = positionInsight.allSignalIds ?? [];
      const signals = archive && signalIds.length > 0 ? await archive.getByIds(signalIds) : [];
      if (signals.length > 0) {
        logger.info('Fetched full signals for deep analysis', {
          symbol,
          requested: signalIds.length,
          found: signals.length,
          withContent: signals.filter((s) => s.content).length,
        });
      }

      // 4. Run deep analysis with streaming + full signal content
      await deepAnalyzePosition({
        providerRouter: router,
        brief,
        insight: positionInsight,
        signals,
        onDelta: (delta) => {
          pubsub.publish(`deepAnalysis:${symbol}`, {
            type: 'TEXT_DELTA',
            symbol,
            delta,
          } satisfies DeepAnalysisEvent);
        },
        onComplete: (content) => {
          pubsub.publish(`deepAnalysis:${symbol}`, {
            type: 'COMPLETE',
            symbol,
            content,
          } satisfies DeepAnalysisEvent);
        },
        onError: (error) => {
          pubsub.publish(`deepAnalysis:${symbol}`, {
            type: 'ERROR',
            symbol,
            error,
          } satisfies DeepAnalysisEvent);
        },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Deep analysis failed', { symbol, error: errorMsg });
      pubsub.publish(`deepAnalysis:${symbol}`, {
        type: 'ERROR',
        symbol,
        error: errorMsg,
      } satisfies DeepAnalysisEvent);
    } finally {
      activeAnalyses.delete(symbol);
    }
  })();

  return true;
}

// ---------------------------------------------------------------------------
// Subscription: onDeepAnalysis
// ---------------------------------------------------------------------------

export const onDeepAnalysisSubscription = {
  subscribe: (_parent: unknown, args: { symbol: string }) => {
    return pubsub.subscribe(`deepAnalysis:${args.symbol}`);
  },
  resolve: (payload: DeepAnalysisEvent) => payload,
};
