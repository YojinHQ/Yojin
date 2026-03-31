/**
 * Lightweight job scheduler — runs a unified intelligence pipeline:
 *
 * 1. Micro research: per-asset AI analysis every 5 minutes (Sonnet LLM call).
 *    Triggered immediately on position/watchlist add, then on a 5-min cadence.
 * 2. Every 15 minutes: fetch data sources → Tier 1 curation → skill evaluation.
 * 3. Macro research: portfolio-wide multi-agent analysis triggered when enough
 *    micro research cycles complete OR on a daily cron schedule.
 *
 * State is persisted to data/cron/state.json so restarts don't re-run
 * a job that already fired within its cooldown window.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { JintelClient } from '@yojinhq/jintel-client';
import { z } from 'zod';

import type { ActionStore } from './actions/action-store.js';
import type { Orchestrator } from './agents/orchestrator.js';
import { emitProgress } from './agents/orchestrator.js';
import type { ProviderRouter } from './ai-providers/router.js';
import { fetchAllEnabledSources } from './api/graphql/resolvers/fetch-data-source.js';
import { AlertsConfigSchema } from './config/config.js';
import type { EventLog } from './core/event-log.js';
import type { NotificationBus } from './core/notification-bus.js';
import type { InsightStore } from './insights/insight-store.js';
import type { MicroInsightStore } from './insights/micro-insight-store.js';
import { runMicroResearch } from './insights/micro-runner.js';
import type { MicroInsightSource } from './insights/micro-types.js';
import { fetchJintelSignals } from './jintel/signal-fetcher.js';
import { createSubsystemLogger } from './logging/logger.js';
import type { SignalMemoryStore } from './memory/memory-store.js';
import type { ReflectionEngine } from './memory/reflection.js';
import type { MemoryAgentRole } from './memory/types.js';
import type { PortfolioSnapshotStore } from './portfolio/snapshot-store.js';
import type { TickerProfileStore } from './profiles/profile-store.js';
import type { SignalArchive } from './signals/archive.js';
import type { CuratedSignalStore } from './signals/curation/curated-signal-store.js';
import { runCurationPipeline } from './signals/curation/pipeline.js';
import type { CurationConfig } from './signals/curation/types.js';
import type { SignalIngestor } from './signals/ingestor.js';
import type { SkillEvaluator } from './skills/skill-evaluator.js';
import { snapFromInsight } from './snap/snap-from-insight.js';
import { snapFromMicro } from './snap/snap-from-micro.js';
import type { SnapStore } from './snap/snap-store.js';
import type { WatchlistStore } from './watchlist/watchlist-store.js';

const logger = createSubsystemLogger('scheduler');

// ---------------------------------------------------------------------------
// Cron state — tracks when each job last ran
// ---------------------------------------------------------------------------

const CronStateSchema = z.object({
  lastRuns: z.record(z.string()).default({}), // jobId → ISO timestamp
});
type CronState = z.infer<typeof CronStateSchema>;

// ---------------------------------------------------------------------------
// Cron matching — minimal parser for "M H * * *" daily schedules
// ---------------------------------------------------------------------------

interface CronFields {
  minute: number;
  hour: number;
}

/** Parse a simple "M H * * *" cron expression. Returns null if unparseable. */
export function parseDailyCron(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const minute = Number(parts[0]);
  const hour = Number(parts[1]);

  if (Number.isNaN(minute) || Number.isNaN(hour)) return null;
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;

  return { minute, hour };
}

/**
 * Check if a cron expression matches a given Date.
 * Only supports "M H * * *" (daily at a specific time).
 */
export function cronMatchesNow(expr: string, now: Date): boolean {
  const fields = parseDailyCron(expr);
  if (!fields) return false;
  return now.getMinutes() === fields.minute && now.getHours() === fields.hour;
}

/**
 * Check if a job already ran today (based on the cron's date in the target timezone).
 */
function alreadyRanToday(lastRunIso: string | undefined, timezone: string): boolean {
  if (!lastRunIso) return false;

  const lastRun = new Date(lastRunIso);
  const now = new Date();

  // Compare dates in the user's timezone
  const lastRunDate = lastRun.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  const todayDate = now.toLocaleDateString('en-CA', { timeZone: timezone });

  return lastRunDate === todayDate;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface SchedulerOptions {
  orchestrator: Orchestrator;
  dataRoot: string;
  /** Check interval in ms (default: 60_000 = 1 minute) */
  checkIntervalMs?: number;
  /** Reflection engine — runs after insights to grade past predictions. */
  reflectionEngine?: ReflectionEngine;
  /** Curation pipeline dependencies — required for scheduled curation. */
  curationPipeline?: {
    signalArchive: SignalArchive;
    curatedStore: CuratedSignalStore;
    snapshotStore: PortfolioSnapshotStore;
    config: CurationConfig;
  };
  /** Skill evaluator — evaluates active skills after curation. */
  skillEvaluator?: SkillEvaluator;
  /** Action store — persists actions created from fired skill triggers. */
  actionStore?: ActionStore;
  /** Portfolio snapshot store — used to build PortfolioContext for skill evaluation. */
  snapshotStore?: PortfolioSnapshotStore;
  /** Snap store — snap brief is regenerated after each curation cycle. */
  snapStore?: SnapStore;
  /** Insight store — latest report is used to derive the snap brief. */
  insightStore?: InsightStore;
  /** Event log — emits domain-specific events for the Activity Log. */
  eventLog?: EventLog;
  /** Jintel client getter — for fetching signals on portfolio change. */
  getJintelClient?: () => JintelClient | undefined;
  /** Signal ingestor — for ingesting Jintel signals. */
  signalIngestor?: SignalIngestor;
  /** Notification bus — publishes domain events for channel delivery. */
  notificationBus?: NotificationBus;

  // --- Micro research dependencies ---
  /** Provider router — for micro research LLM calls. */
  providerRouter?: ProviderRouter;
  /** Micro insight store — per-ticker JSONL storage for micro research outputs. */
  microInsightStore?: MicroInsightStore;
  /** Watchlist store — to register watchlist assets for micro research. */
  watchlistStore?: WatchlistStore;
  /** Memory stores — per-role signal memory for building DataBriefs. */
  memoryStores?: Map<MemoryAgentRole, SignalMemoryStore>;
  /** Ticker profile store — per-asset knowledge for DataBriefs. */
  profileStore?: TickerProfileStore;
  /** Curated signal store — for building single-ticker DataBriefs. */
  curatedSignalStore?: CuratedSignalStore;
  /** Micro research interval in ms (default: 5 * 60_000 = 5 minutes). */
  microIntervalMs?: number;
}

/** Minimum interval between curation runs (15 minutes). */
const CURATION_INTERVAL_MS = 15 * 60 * 1000;

/** Minimum interval between insight runs (2 hours) — prevents over-processing. */
const INSIGHTS_COOLDOWN_MS = 2 * 60 * 60 * 1000;

/** Minimum curated signals to justify an insights run. */
const MIN_SIGNALS_FOR_INSIGHTS = 3;

/** Default expiry window for actions created from skill triggers. */
const ACTION_EXPIRY_HOURS = 24;

/** Default micro research interval (5 minutes). */
const DEFAULT_MICRO_INTERVAL_MS = 5 * 60 * 1000;

/** Micro tick interval — how often we check for due micro research (30 seconds). */
const MICRO_TICK_INTERVAL_MS = 30_000;

/** Max concurrent micro research runs per tick. */
const MAX_MICRO_CONCURRENCY = 3;

/** How many micro completions before triggering a macro run. */
const MICRO_THRESHOLD_FOR_MACRO = 5;

interface MicroAssetState {
  symbol: string;
  source: MicroInsightSource;
  lastMicroAt: string | null;
}

export class Scheduler {
  private readonly orchestrator: Orchestrator;
  private readonly dataRoot: string;
  private readonly checkIntervalMs: number;
  private readonly reflectionEngine?: ReflectionEngine;
  private readonly curationPipeline?: SchedulerOptions['curationPipeline'];
  private readonly skillEvaluator?: SkillEvaluator;
  private readonly actionStore?: ActionStore;
  private readonly snapshotStore?: PortfolioSnapshotStore;
  private readonly snapStore?: SnapStore;
  private readonly insightStore?: InsightStore;
  private readonly eventLog?: EventLog;
  private readonly getJintelClient?: () => JintelClient | undefined;
  private readonly signalIngestor?: SignalIngestor;
  private readonly notificationBus?: NotificationBus;

  // Micro research dependencies
  private readonly providerRouter?: ProviderRouter;
  private readonly microInsightStore?: MicroInsightStore;
  private readonly watchlistStore?: WatchlistStore;
  private readonly memoryStores?: Map<MemoryAgentRole, SignalMemoryStore>;
  private readonly profileStore?: TickerProfileStore;
  private readonly curatedSignalStore?: CuratedSignalStore;
  private readonly microIntervalMs: number;

  // Timers
  private timer: ReturnType<typeof setInterval> | null = null;
  private microTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private microRunning = false;

  // Micro research state
  private readonly microRegistry = new Map<string, MicroAssetState>();
  private microCompletionCount = 0;

  constructor(options: SchedulerOptions) {
    this.orchestrator = options.orchestrator;
    this.dataRoot = options.dataRoot;
    this.checkIntervalMs = options.checkIntervalMs ?? 60_000;
    this.reflectionEngine = options.reflectionEngine;
    this.curationPipeline = options.curationPipeline;
    this.skillEvaluator = options.skillEvaluator;
    this.actionStore = options.actionStore;
    this.snapshotStore = options.snapshotStore;
    this.snapStore = options.snapStore;
    this.insightStore = options.insightStore;
    this.eventLog = options.eventLog;
    this.getJintelClient = options.getJintelClient;
    this.signalIngestor = options.signalIngestor;
    this.notificationBus = options.notificationBus;

    // Micro research
    this.providerRouter = options.providerRouter;
    this.microInsightStore = options.microInsightStore;
    this.watchlistStore = options.watchlistStore;
    this.memoryStores = options.memoryStores;
    this.profileStore = options.profileStore;
    this.curatedSignalStore = options.curatedSignalStore;
    this.microIntervalMs = options.microIntervalMs ?? DEFAULT_MICRO_INTERVAL_MS;
  }

  /** Start the scheduler. Checks once per minute + micro tick every 30s. */
  start(): void {
    if (this.timer) return;
    logger.info('Scheduler started', { checkIntervalMs: this.checkIntervalMs, microIntervalMs: this.microIntervalMs });

    // Populate micro registry from current portfolio + watchlist
    void this.populateMicroRegistry();

    // Check immediately on start, then at interval
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.checkIntervalMs);

    // Micro research tick — checks for due assets every 30s
    if (this.providerRouter && this.microInsightStore) {
      this.microTimer = setInterval(() => void this.microTick(), MICRO_TICK_INTERVAL_MS);
    }
  }

  /** Stop the scheduler. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.microTimer) {
      clearInterval(this.microTimer);
      this.microTimer = null;
    }
    logger.info('Scheduler stopped');
  }

  // ---------------------------------------------------------------------------
  // Micro research — per-asset AI analysis (Sonnet LLM call)
  // ---------------------------------------------------------------------------

  /**
   * Trigger micro research for specific tickers (e.g. after position add/edit).
   * Registers assets in the micro registry and runs research immediately.
   * Debounced 3s to batch rapid position changes.
   */
  private pendingMicroTickers: Map<string, MicroInsightSource> = new Map();
  private pendingMicroTimer: ReturnType<typeof setTimeout> | null = null;

  triggerMicroFlow(tickers: string[], source: MicroInsightSource = 'portfolio'): void {
    for (const t of tickers) {
      const symbol = t.toUpperCase();
      this.pendingMicroTickers.set(symbol, source);
      // Register/update in micro registry
      this.microRegistry.set(symbol, {
        symbol,
        source,
        lastMicroAt: null, // force immediate run
      });
    }
    if (this.pendingMicroTimer) return; // already debounced
    this.pendingMicroTimer = setTimeout(() => {
      const batch = [...this.pendingMicroTickers.entries()];
      this.pendingMicroTickers.clear();
      this.pendingMicroTimer = null;
      void this.runMicroResearchBatch(batch.map(([symbol, src]) => ({ symbol, source: src })));
    }, 3_000);
  }

  /** Backward-compat alias — triggers macro flow for full portfolio analysis. */
  triggerCuration(): void {
    void this.runMacroFlow();
  }

  /**
   * Populate the micro registry from current portfolio + watchlist.
   * Called once on scheduler start.
   */
  private async populateMicroRegistry(): Promise<void> {
    const store = this.snapshotStore ?? this.curationPipeline?.snapshotStore;
    if (store) {
      const snapshot = await store.getLatest();
      if (snapshot) {
        for (const pos of snapshot.positions) {
          const symbol = pos.symbol.toUpperCase();
          if (!this.microRegistry.has(symbol)) {
            this.microRegistry.set(symbol, { symbol, source: 'portfolio', lastMicroAt: null });
          }
        }
      }
    }

    if (this.watchlistStore) {
      for (const entry of this.watchlistStore.list()) {
        const symbol = entry.symbol.toUpperCase();
        if (!this.microRegistry.has(symbol)) {
          this.microRegistry.set(symbol, { symbol, source: 'watchlist', lastMicroAt: null });
        }
      }
    }

    if (this.microRegistry.size > 0) {
      logger.info('Micro registry populated', { assetCount: this.microRegistry.size });
    }
  }

  /**
   * Micro tick — scans the micro registry for assets due for research.
   * Runs up to MAX_MICRO_CONCURRENCY in parallel.
   */
  private async microTick(): Promise<void> {
    if (this.microRunning) return;
    if (!this.providerRouter || !this.microInsightStore) return;

    const now = Date.now();
    const due: MicroAssetState[] = [];

    for (const state of this.microRegistry.values()) {
      if (!state.lastMicroAt) {
        due.push(state);
      } else {
        const elapsed = now - new Date(state.lastMicroAt).getTime();
        if (elapsed >= this.microIntervalMs) {
          due.push(state);
        }
      }
    }

    if (due.length === 0) return;

    // Take at most MAX_MICRO_CONCURRENCY assets
    const batch = due.slice(0, MAX_MICRO_CONCURRENCY);
    await this.runMicroResearchBatch(batch);
  }

  /**
   * Run micro research for a batch of assets in parallel.
   */
  private async runMicroResearchBatch(assets: Array<{ symbol: string; source: MicroInsightSource }>): Promise<void> {
    const { providerRouter, microInsightStore } = this;
    if (!providerRouter || !microInsightStore || assets.length === 0) return;
    if (this.microRunning) {
      // Re-queue tickers so they're picked up on the next micro tick
      for (const a of assets) this.pendingMicroTickers.set(a.symbol, a.source);
      logger.info('Micro research deferred — already running, tickers re-queued', {
        assets: assets.map((a) => a.symbol),
      });
      return;
    }

    this.microRunning = true;
    const symbols = assets.map((a) => a.symbol);
    logger.info('Micro research batch started', { symbols });

    try {
      // First, fetch Jintel signals for these tickers
      const jintelClient = this.getJintelClient?.();
      if (jintelClient && this.signalIngestor) {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const result = await fetchJintelSignals(jintelClient, this.signalIngestor, symbols, { since });
        if (result.ingested > 0) {
          logger.info('Micro research Jintel fetch', { ingested: result.ingested, duplicates: result.duplicates });
        }
      }

      // Curate signals so DataBriefs have fresh curated data
      if (this.curationPipeline) {
        await runCurationPipeline(this.curationPipeline);
      }

      // Resolve the curated signal store
      const curatedStore = this.curatedSignalStore ?? this.curationPipeline?.curatedStore;
      const snapshotStore = this.snapshotStore ?? this.curationPipeline?.snapshotStore;
      if (!curatedStore || !snapshotStore) {
        logger.warn('Micro research skipped — missing curatedSignalStore or snapshotStore');
        return;
      }

      // Run micro research in parallel (up to MAX_MICRO_CONCURRENCY)
      // Note: getJintelClient/signalIngestor are omitted here because the batch
      // already fetched + curated Jintel signals above — no need to re-fetch per ticker.
      const results = await Promise.allSettled(
        assets.map((asset) =>
          runMicroResearch(asset.symbol, asset.source, {
            providerRouter,
            microInsightStore,
            briefOptions: {
              snapshotStore,
              curatedSignalStore: curatedStore,
              getJintelClient: this.getJintelClient,
              memoryStores: this.memoryStores ?? new Map(),
              profileStore: this.profileStore,
            },
            actionStore: this.actionStore,
            eventLog: this.eventLog,
          }),
        ),
      );

      // Update registry timestamps and count completions
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const asset = assets[i];
        if (!result || !asset) continue;
        const symbol = asset.symbol;

        if (result.status === 'fulfilled' && result.value.insight) {
          const state = this.microRegistry.get(symbol);
          if (state) state.lastMicroAt = new Date().toISOString();
          this.microCompletionCount++;

          logger.info('Micro research complete', {
            symbol,
            rating: result.value.insight.rating,
            durationMs: result.value.durationMs,
          });
        } else if (result.status === 'rejected') {
          logger.error('Micro research failed', { symbol, error: String(result.reason) });
        }
      }

      // Regenerate snap from micro insights (immediate feedback before macro)
      await this.regenerateSnapFromMicro();

      // Check if we should trigger macro
      if (this.microCompletionCount >= MICRO_THRESHOLD_FOR_MACRO) {
        logger.info('Micro threshold reached — triggering macro flow', { completions: this.microCompletionCount });
        this.microCompletionCount = 0;
        void this.runMacroFlow();
      }
    } catch (err) {
      logger.error('Micro research batch failed', { error: err, symbols });
    } finally {
      this.microRunning = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Macro flow — portfolio-wide analysis (insights, snap, actions)
  // ---------------------------------------------------------------------------

  private async runMacroFlow(): Promise<void> {
    if (!this.curationPipeline) return;
    if (this.running) {
      logger.info('Skipping macro flow — scheduler already running');
      return;
    }

    logger.info('Macro flow started — portfolio-wide analysis');
    this.running = true;
    try {
      // Fetch CLI data sources
      const fetchResult = await fetchAllEnabledSources();
      if (fetchResult.totalIngested > 0 && this.eventLog) {
        await this.eventLog.append({
          type: 'system',
          data: {
            message: `Fetched ${fetchResult.totalIngested} new signal${fetchResult.totalIngested !== 1 ? 's' : ''} from ${fetchResult.sourcesAttempted} data source${fetchResult.sourcesAttempted !== 1 ? 's' : ''}`,
          },
        });
      }

      // Fetch Jintel signals for ALL portfolio tickers
      const jintelClient = this.getJintelClient?.();
      if (jintelClient && this.signalIngestor) {
        const store = this.snapshotStore ?? this.curationPipeline.snapshotStore;
        const snapshot = await store.getLatest();
        if (snapshot && snapshot.positions.length > 0) {
          const allTickers = snapshot.positions.map((p) => p.symbol);
          const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
          const jintelResult = await fetchJintelSignals(jintelClient, this.signalIngestor, allTickers, { since });
          logger.info('Macro flow Jintel fetch complete', {
            ingested: jintelResult.ingested,
            duplicates: jintelResult.duplicates,
            tickers: jintelResult.tickers,
          });
        }
      }

      // Full curation pass
      const result = await runCurationPipeline(this.curationPipeline);
      logger.info('Macro flow curation complete', {
        signalsProcessed: result.signalsProcessed,
        signalsCurated: result.signalsCurated,
      });

      // Regenerate snap + evaluate skills
      await this.regenerateSnap();
      await this.evaluateSkillsAfterCuration();

      // Trigger insights if enough new data
      // signalsCurated already includes Jintel signals that passed curation — don't double-count
      if (result.signalsCurated >= MIN_SIGNALS_FOR_INSIGHTS) {
        await this.maybeRunInsights(result.signalsCurated);
      }
    } catch (err) {
      logger.error('Macro flow failed', { error: err });
    } finally {
      this.running = false;
    }
  }

  /** Single tick — check if any scheduled jobs should fire. */
  private async tick(): Promise<void> {
    if (this.running) return; // Prevent overlapping runs
    this.running = true;

    try {
      await this.checkCurationSchedule();
      await this.checkInsightsSchedule();
    } catch (err) {
      logger.error('Scheduler tick failed', { error: err });
    } finally {
      this.running = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Curation schedule (every 15 minutes)
  // ---------------------------------------------------------------------------

  /**
   * Run the Tier 1 curation pipeline if 15+ minutes have elapsed since the
   * last run.  After curation, evaluate active skills and create Actions for
   * any triggers that fire.
   */
  private async checkCurationSchedule(): Promise<void> {
    if (!this.curationPipeline) return;

    const state = await this.loadState();
    const lastRun = state.lastRuns['run-curation'];

    if (lastRun) {
      const elapsed = Date.now() - new Date(lastRun).getTime();
      if (elapsed < CURATION_INTERVAL_MS) return;
    }

    logger.info('Triggering scheduled data fetch + curation pipeline');

    // Persist the watermark before execution to prevent re-runs on crash
    state.lastRuns['run-curation'] = new Date().toISOString();
    await this.saveState(state);

    try {
      // Fetch fresh signals from all enabled data sources before curation
      const fetchResult = await fetchAllEnabledSources();
      if (fetchResult.totalIngested > 0) {
        logger.info('Pre-curation data fetch', {
          ingested: fetchResult.totalIngested,
          duplicates: fetchResult.totalDuplicates,
          sources: fetchResult.sourcesAttempted,
        });

        if (this.eventLog) {
          await this.eventLog.append({
            type: 'system',
            data: {
              message: `Fetched ${fetchResult.totalIngested} new signal${fetchResult.totalIngested !== 1 ? 's' : ''} from ${fetchResult.sourcesAttempted} data source${fetchResult.sourcesAttempted !== 1 ? 's' : ''}`,
            },
          });
        }
      }

      const result = await runCurationPipeline(this.curationPipeline);

      logger.info('Scheduled curation complete', {
        signalsProcessed: result.signalsProcessed,
        signalsCurated: result.signalsCurated,
        durationMs: result.durationMs,
      });

      if (this.eventLog && result.signalsProcessed > 0) {
        await this.eventLog.append({
          type: 'system',
          data: {
            message: `Signal curation completed — ${result.signalsCurated} of ${result.signalsProcessed} signals curated`,
          },
        });
      }

      // Save a history snapshot so the Total Value chart accumulates data
      // over time — even when positions aren't modified.
      const historyStore = this.snapshotStore ?? this.curationPipeline?.snapshotStore;
      if (historyStore) {
        try {
          const latest = await historyStore.getLatest();
          if (latest && latest.positions.length > 0) {
            await historyStore.appendHistoryPoint(latest);
          }
        } catch (err) {
          logger.warn('Failed to save history snapshot', { error: err });
        }
      }

      // Regenerate snap brief from latest insight report
      await this.regenerateSnap();

      // Evaluate active skills after curation
      await this.evaluateSkillsAfterCuration();

      // Trigger insights if meaningful new signals warrant it
      if (result.signalsCurated >= MIN_SIGNALS_FOR_INSIGHTS) {
        await this.maybeRunInsights(result.signalsCurated);
      }
    } catch (err) {
      logger.error('Scheduled curation failed', { error: err });
    }
  }

  /**
   * Regenerate snap from micro insights — provides immediate feedback
   * after each micro batch without waiting for the full macro flow.
   * Once a macro InsightReport exists, `regenerateSnap` takes over.
   */
  private async regenerateSnapFromMicro(): Promise<void> {
    if (!this.snapStore || !this.microInsightStore || !this.providerRouter) return;

    try {
      // If a macro insight report already exists, skip — regenerateSnap handles it
      if (this.insightStore) {
        const report = await this.insightStore.getLatest();
        if (report) return;
      }

      const microInsights = await this.microInsightStore.getAllLatest();
      if (microInsights.size === 0) return;

      // Build portfolio exposure context so the snap prioritizes high-weight positions
      const store = this.snapshotStore ?? this.curationPipeline?.snapshotStore;
      let exposure: import('./snap/snap-from-micro.js').PortfolioExposure[] | undefined;
      if (store) {
        const snapshot = await store.getLatest();
        if (snapshot && snapshot.totalValue > 0) {
          exposure = snapshot.positions.map((p) => ({
            symbol: p.symbol,
            weight: p.marketValue / snapshot.totalValue,
            marketValue: p.marketValue,
          }));
        }
      }

      // Load previous snap so the synthesizer can make deliberate update decisions
      const previousSnap = await this.snapStore.getLatest();

      const snap = await snapFromMicro(microInsights, this.providerRouter, exposure, previousSnap);
      if (!snap) return;

      await this.snapStore.save(snap);
      logger.info('Snap brief generated from micro insights', { snapId: snap.id, assets: microInsights.size });
      this.notificationBus?.publish({ type: 'snap.ready', snapId: snap.id });
    } catch (err) {
      logger.warn('Failed to generate snap from micro insights', { error: err });
    }
  }

  /**
   * Regenerate the snap brief from the latest insight report.
   * Runs after each curation cycle (~every 15 minutes).
   */
  private async regenerateSnap(): Promise<void> {
    if (!this.snapStore || !this.insightStore) return;

    try {
      const report = await this.insightStore.getLatest();
      if (!report) return;

      const microInsights = this.microInsightStore ? await this.microInsightStore.getAllLatest() : undefined;
      const snap = snapFromInsight(report, microInsights ? { microInsights } : undefined);
      await this.snapStore.save(snap);
      logger.info('Snap brief regenerated', { snapId: snap.id });
      this.notificationBus?.publish({ type: 'snap.ready', snapId: snap.id });

      if (this.eventLog) {
        await this.eventLog.append({
          type: 'system',
          data: { message: 'Snap brief updated' },
        });
      }
    } catch (err) {
      logger.warn('Failed to regenerate snap', { error: err });
    }
  }

  /**
   * After curation, evaluate active skills against current portfolio state
   * and create Actions for any triggers that fire.
   */
  private async evaluateSkillsAfterCuration(): Promise<void> {
    if (!this.skillEvaluator || !this.actionStore) return;

    // Resolve snapshot store — prefer the top-level option, fall back to curation pipeline's store
    const store = this.snapshotStore ?? this.curationPipeline?.snapshotStore;
    if (!store) return;

    const snapshot = await store.getLatest();
    if (!snapshot || snapshot.positions.length === 0) {
      logger.info('No portfolio snapshot — skipping skill evaluation');
      return;
    }

    // Build PortfolioContext from the latest snapshot
    const weights: Record<string, number> = {};
    const prices: Record<string, number> = {};

    for (const position of snapshot.positions) {
      weights[position.symbol] = snapshot.totalValue > 0 ? position.marketValue / snapshot.totalValue : 0;
      prices[position.symbol] = position.currentPrice;
    }

    // Partial context — only weights and prices are available from the snapshot.
    // priceChanges, indicators, earningsDays, and drawdowns will be populated
    // once the enrichment pipeline wires these data sources. Trigger checks
    // skip evaluation when their required data is absent (returns null).
    const context = {
      weights,
      prices,
      priceChanges: {} as Record<string, number>,
      indicators: {} as Record<string, Record<string, number>>,
      earningsDays: {} as Record<string, number>,
      portfolioDrawdown: 0,
      positionDrawdowns: {} as Record<string, number>,
    };

    const evaluations = this.skillEvaluator.evaluate(context);

    if (evaluations.length === 0) {
      logger.info('No skill triggers fired');
      return;
    }

    logger.info(`${evaluations.length} skill trigger(s) fired — creating actions`);

    if (this.eventLog) {
      const names = evaluations.map((e) => e.skillName).join(', ');
      await this.eventLog.append({
        type: 'action',
        data: { message: `${evaluations.length} skill trigger${evaluations.length !== 1 ? 's' : ''} fired: ${names}` },
      });
    }

    const expiresAt = new Date(Date.now() + ACTION_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    for (const evaluation of evaluations) {
      const contextSummary = Object.entries(evaluation.context)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(', ');

      const result = await this.actionStore.create({
        id: randomUUID(),
        skillId: evaluation.skillId,
        what: `Skill "${evaluation.skillName}" trigger fired: ${evaluation.triggerType}`,
        why: `Trigger ${evaluation.triggerId} fired with context: ${contextSummary}`,
        source: `skill: ${evaluation.skillName}`,
        status: 'PENDING',
        expiresAt,
        createdAt: now,
      });

      if (result.success) {
        logger.info('Action created from skill trigger', {
          actionId: result.data.id,
          skillId: evaluation.skillId,
          triggerType: evaluation.triggerType,
        });
        this.notificationBus?.publish({
          type: 'action.created',
          actionId: result.data.id,
          ticker: evaluation.context.ticker as string | undefined,
        });
      } else {
        logger.warn('Failed to create action from skill trigger', {
          error: result.error,
          skillId: evaluation.skillId,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Insights — triggered automatically after curation when warranted
  // ---------------------------------------------------------------------------

  /**
   * Run insights if enough time has passed since the last run.
   * Called after curation when new signals were curated.
   *
   * Gate logic:
   * - No insights ever generated → always run (first-time bootstrap)
   * - Last insights run < INSIGHTS_COOLDOWN_MS ago → skip
   * - Otherwise → run
   */
  private async maybeRunInsights(signalsCurated: number): Promise<void> {
    const state = await this.loadState();
    const lastInsightsRun = state.lastRuns['process-insights'];

    if (lastInsightsRun) {
      const elapsed = Date.now() - new Date(lastInsightsRun).getTime();
      if (elapsed < INSIGHTS_COOLDOWN_MS) {
        logger.info('Skipping insights — cooldown not elapsed', {
          elapsedMin: Math.round(elapsed / 60_000),
          cooldownMin: Math.round(INSIGHTS_COOLDOWN_MS / 60_000),
          signalsCurated,
        });
        return;
      }
    }

    await this.runInsightsWorkflow(`Auto-triggered after curation — ${signalsCurated} new signals curated`);
  }

  /**
   * Also check the daily cron schedule — ensures insights run at least once
   * per day even if curation produces fewer than MIN_SIGNALS_FOR_INSIGHTS.
   */
  private async checkInsightsSchedule(): Promise<void> {
    const config = await this.loadAlertsConfig();
    if (!config.digestSchedule) return;

    const { cron, timezone } = config.digestSchedule;
    const now = this.nowInTimezone(timezone);

    if (!cronMatchesNow(cron, now)) return;

    // Check if already ran today
    const state = await this.loadState();
    if (alreadyRanToday(state.lastRuns['process-insights'], timezone)) return;

    await this.runInsightsWorkflow('Scheduled daily portfolio insights');
  }

  /** Shared insights execution — used by both auto-trigger and daily cron. */
  private async runInsightsWorkflow(reason: string): Promise<void> {
    logger.info('Triggering process-insights workflow', { reason });

    emitProgress({
      workflowId: 'process-insights',
      stage: 'activity',
      message: reason,
      timestamp: new Date().toISOString(),
    });

    // Persist attempt before executing to prevent re-triggering
    const state = await this.loadState();
    state.lastRuns['process-insights'] = new Date().toISOString();
    await this.saveState(state);

    try {
      await this.orchestrator.execute('process-insights', {
        message: reason,
      });

      logger.info('Process-insights completed');

      // Notify channels that a new insight report is available
      const latestInsight = await this.insightStore?.getLatest();
      if (latestInsight) {
        this.notificationBus?.publish({ type: 'insight.ready', insightId: latestInsight.id });
      }

      if (this.eventLog) {
        await this.eventLog.append({
          type: 'insight',
          data: { message: 'Portfolio insights report generated' },
        });
      }

      // Run reflection sweep after insights — grades past predictions older than 7 days
      if (this.reflectionEngine) {
        try {
          const sweep = await this.reflectionEngine.runSweep({ olderThanDays: 7 });
          logger.info('Post-insights reflection sweep completed', { ...sweep });
        } catch (err) {
          logger.warn('Reflection sweep failed (non-fatal)', { error: err });
        }
      }
    } catch (err) {
      logger.error('Process-insights failed', { error: err });
    }
  }

  /**
   * Get the current time as a Date in the target timezone.
   * We need minute/hour in the user's timezone to match the cron expression.
   */
  private nowInTimezone(timezone: string): Date {
    const now = new Date();
    // Format in target timezone to get local hour/minute
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now);

    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);

    // Return a Date with the timezone-adjusted hour/minute
    // (only used for cron matching, not persistence)
    const adjusted = new Date(now);
    adjusted.setHours(hour, minute, 0, 0);
    return adjusted;
  }

  // ---------------------------------------------------------------------------
  // Config & state I/O
  // ---------------------------------------------------------------------------

  private async loadAlertsConfig(): Promise<z.infer<typeof AlertsConfigSchema>> {
    const configPath = join(this.dataRoot, 'config', 'alerts.json');
    try {
      const raw = await readFile(configPath, 'utf-8');
      return AlertsConfigSchema.parse(JSON.parse(raw));
    } catch {
      return AlertsConfigSchema.parse({});
    }
  }

  private statePath(): string {
    return join(this.dataRoot, 'cron', 'state.json');
  }

  private async loadState(): Promise<CronState> {
    try {
      const raw = await readFile(this.statePath(), 'utf-8');
      return CronStateSchema.parse(JSON.parse(raw));
    } catch {
      return { lastRuns: {} };
    }
  }

  private async saveState(state: CronState): Promise<void> {
    const dir = join(this.dataRoot, 'cron');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.statePath(), JSON.stringify(state, null, 2));
  }
}
