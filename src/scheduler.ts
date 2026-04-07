/**
 * Lightweight job scheduler — two-flow intelligence pipeline:
 *
 * 1. **Micro flow**: per-asset AI analysis every 5 minutes (Sonnet LLM call).
 *    Triggered immediately on position/watchlist add or website open,
 *    then on a 5-min cadence. Keeps per-ticker data fresh.
 *
 * 2. **Macro flow**: portfolio-wide multi-agent analysis every 2 hours.
 *    Also triggers when all micro flows complete for all assets today.
 *    Pipeline: signal assessment (RA + Strategist) → ProcessInsights →
 *    skill evaluation → snap → reflection.
 *
 * State is persisted to data/cron/state.json so restarts don't re-run
 * a job that already fired within its cooldown window.
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { JintelClient } from '@yojinhq/jintel-client';
import { z } from 'zod';

import type { ActionStore } from './actions/action-store.js';
import type { Orchestrator } from './agents/orchestrator.js';
import { emitProgress } from './agents/orchestrator.js';
import type { ProviderRouter } from './ai-providers/router.js';
import type { EventLog } from './core/event-log.js';
import type { NotificationBus } from './core/notification-bus.js';
import type { InsightStore } from './insights/insight-store.js';
import type { MicroInsightStore } from './insights/micro-insight-store.js';
import { runMicroResearch } from './insights/micro-runner.js';
import type { MicroInsightSource } from './insights/micro-types.js';
import { fetchJintelSignals, fetchMacroIndicators } from './jintel/signal-fetcher.js';
import { createSubsystemLogger } from './logging/logger.js';
import type { SignalMemoryStore } from './memory/memory-store.js';
import type { ReflectionEngine } from './memory/reflection.js';
import type { MemoryAgentRole } from './memory/types.js';
import type { PortfolioSnapshotStore } from './portfolio/snapshot-store.js';
import type { TickerProfileStore } from './profiles/profile-store.js';
import type { SignalArchive } from './signals/archive.js';
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
  lastRuns: z.record(z.string(), z.string()).default({}), // jobId → ISO timestamp
  dailyRunCount: z.number().default(0),
  dailyRunBudgetDate: z.string().default(''), // YYYY-MM-DD UTC
  lastMacroCompletedAt: z.number().default(0), // epoch ms
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
  /** Signal archive — for building single-ticker DataBriefs. */
  signalArchive?: SignalArchive;
  /** Micro research interval in ms (default: 5 * 60_000 = 5 minutes). */
  microIntervalMs?: number;
  /**
   * Max LLM agent runs per calendar day (UTC). When the budget is exhausted,
   * the scheduler stops firing new workflows until midnight UTC.
   * Default: 20. Set to 0 to disable the cap.
   */
  dailyRunBudget?: number;
}

/** Minimum interval between macro flow runs (2 hours). */
const MACRO_INTERVAL_MS = 2 * 60 * 60 * 1000;

/**
 * Minimum interval before micro research can re-trigger a macro flow after
 * one just completed. Prevents the reset-flags → micro-completes → trigger
 * loop that would otherwise fire a macro every ~5 minutes.
 */
const MICRO_TRIGGER_MACRO_COOLDOWN_MS = MACRO_INTERVAL_MS;

/** Max LLM agent runs per calendar day. Exceeding this stops the scheduler for the day. */
const DEFAULT_DAILY_RUN_BUDGET = 20;

/** Default expiry window for actions created from skill triggers. */
const ACTION_EXPIRY_HOURS = 24;

/** Default micro research interval (5 minutes). */
const DEFAULT_MICRO_INTERVAL_MS = 5 * 60 * 1000;

/** Micro tick interval — how often we check for due micro research (30 seconds). */
const MICRO_TICK_INTERVAL_MS = 30_000;

/** Minimum interval between snap.ready notifications to channels (1 hour). */
const SNAP_NOTIFY_COOLDOWN_MS = 60 * 60 * 1000;

/** Hash snap content for dedup — only notify channels when content actually changes. */
function snapContentHash(snap: { intelSummary?: string; actionItems: { text: string }[] }): string {
  return createHash('sha256')
    .update(JSON.stringify({ intelSummary: snap.intelSummary ?? '', actionItems: snap.actionItems.map((a) => a.text) }))
    .digest('hex');
}

/** Max concurrent micro research runs per tick. */
const MAX_MICRO_CONCURRENCY = 3;

interface MicroAssetState {
  symbol: string;
  source: MicroInsightSource;
  lastMicroAt: string | null;
  /** Whether this asset has completed micro research today. */
  completedToday: boolean;
}

export class Scheduler {
  private readonly orchestrator: Orchestrator;
  private readonly dataRoot: string;
  private readonly checkIntervalMs: number;
  private readonly reflectionEngine?: ReflectionEngine;
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
  private readonly signalArchive?: SignalArchive;
  private readonly microIntervalMs: number;

  // Timers
  private timer: ReturnType<typeof setInterval> | null = null;
  private microTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private microRunning = false;

  // Micro research state
  private readonly microRegistry = new Map<string, MicroAssetState>();

  // Generation counter — incremented on reset() to invalidate in-flight batches
  private resetGeneration = 0;

  // Snap notification dedup — prevent channel spam
  private lastSnapContentHash: string | undefined;
  private lastSnapNotifiedAt = 0;

  // Daily LLM run budget — resets at midnight UTC
  private dailyRunCount = 0;
  private dailyRunBudgetDate = ''; // YYYY-MM-DD the count belongs to
  private readonly dailyRunBudget: number;

  // Timestamp of last macro flow completion — used to gate micro→macro re-triggers
  private lastMacroCompletedAt = 0;

  constructor(options: SchedulerOptions) {
    this.orchestrator = options.orchestrator;
    this.dataRoot = options.dataRoot;
    this.checkIntervalMs = options.checkIntervalMs ?? 60_000;
    this.reflectionEngine = options.reflectionEngine;
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
    this.signalArchive = options.signalArchive;
    this.microIntervalMs = options.microIntervalMs ?? DEFAULT_MICRO_INTERVAL_MS;
    this.dailyRunBudget = options.dailyRunBudget ?? DEFAULT_DAILY_RUN_BUDGET;
  }

  /**
   * Check and increment the daily run budget.
   * Returns true if a run is allowed, false if the daily cap is exhausted.
   * The counter resets at midnight UTC.
   */
  private checkDailyBudget(runsToConsume = 1): boolean {
    if (this.dailyRunBudget === 0) return true; // disabled

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    if (this.dailyRunBudgetDate !== today) {
      this.dailyRunCount = 0;
      this.dailyRunBudgetDate = today;
    }

    if (this.dailyRunCount + runsToConsume > this.dailyRunBudget) {
      logger.warn('Daily LLM run budget exhausted — skipping workflow', {
        dailyRunCount: this.dailyRunCount,
        dailyRunBudget: this.dailyRunBudget,
        date: today,
      });
      return false;
    }

    this.dailyRunCount += runsToConsume;
    void this.persistBudgetState();
    return true;
  }

  /** Load persisted budget + macro state into memory on startup. */
  private async hydrateFromState(): Promise<void> {
    try {
      const state = await this.loadState();
      this.dailyRunCount = state.dailyRunCount;
      this.dailyRunBudgetDate = state.dailyRunBudgetDate;
      this.lastMacroCompletedAt = state.lastMacroCompletedAt;
    } catch {
      // Start fresh — in-memory defaults are already set
    }
  }

  /** Persist current budget + macro watermark into state.json (best-effort). */
  private async persistBudgetState(): Promise<void> {
    try {
      const state = await this.loadState();
      state.dailyRunCount = this.dailyRunCount;
      state.dailyRunBudgetDate = this.dailyRunBudgetDate;
      state.lastMacroCompletedAt = this.lastMacroCompletedAt;
      await this.saveState(state);
    } catch (err) {
      logger.warn('Failed to persist budget state', { error: err });
    }
  }

  /** Start the scheduler. Checks once per minute + micro tick every 30s. */
  start(): void {
    if (this.timer) return;
    logger.info('Scheduler started', { checkIntervalMs: this.checkIntervalMs, microIntervalMs: this.microIntervalMs });

    // Hydrate persisted budget + macro state so restarts preserve the daily count
    void this.hydrateFromState();

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

  /**
   * Reset in-memory state after "Clear App Data".
   * Clears the micro registry so stale tickers don't trigger research,
   * and resets snap dedup so a fresh snap isn't suppressed.
   */
  reset(): void {
    this.resetGeneration++;
    this.microRegistry.clear();
    this.lastSnapContentHash = undefined;
    this.lastSnapNotifiedAt = 0;
    if (this.pendingMicroTimer) {
      clearTimeout(this.pendingMicroTimer);
      this.pendingMicroTimer = null;
    }
    this.pendingMicroTickers.clear();
    logger.info('Scheduler state reset');
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
      const existing = this.microRegistry.get(symbol);
      this.microRegistry.set(symbol, {
        symbol,
        source,
        lastMicroAt: null, // force immediate run
        completedToday: existing?.completedToday ?? false,
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

  /**
   * Populate the micro registry from current portfolio + watchlist.
   * Called once on scheduler start.
   */
  private async populateMicroRegistry(): Promise<void> {
    const store = this.snapshotStore;
    if (store) {
      const snapshot = await store.getLatest();
      if (snapshot) {
        for (const pos of snapshot.positions) {
          const symbol = pos.symbol.toUpperCase();
          if (!this.microRegistry.has(symbol)) {
            this.microRegistry.set(symbol, { symbol, source: 'portfolio', lastMicroAt: null, completedToday: false });
          }
        }
      }
    }

    if (this.watchlistStore) {
      for (const entry of this.watchlistStore.list()) {
        const symbol = entry.symbol.toUpperCase();
        if (!this.microRegistry.has(symbol)) {
          this.microRegistry.set(symbol, { symbol, source: 'watchlist', lastMicroAt: null, completedToday: false });
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
    const gen = this.resetGeneration;
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

      // Resolve dependencies for micro research
      const archive = this.signalArchive;
      const snapshotStore = this.snapshotStore;
      if (!archive || !snapshotStore) {
        logger.warn('Micro research skipped — missing signalArchive or snapshotStore');
        return;
      }

      // Each asset = 1 LLM run. Gate against daily budget only after confirming
      // all dependencies are present — avoids burning quota on runs that won't execute.
      if (!this.checkDailyBudget(assets.length)) return;

      // Run micro research in parallel (up to MAX_MICRO_CONCURRENCY)
      // Note: getJintelClient/signalIngestor are omitted from the top-level deps
      // (so runMicroResearch won't re-fetch signals per ticker — already batch-fetched above).
      // getJintelClient IS passed in briefOptions so buildSingleBrief can enrich entities
      // for fundamentals, risk, technicals etc. that signals alone don't provide.
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const results = await Promise.allSettled(
        assets.map((asset) => {
          const isFirstRun = this.microRegistry.get(asset.symbol)?.lastMicroAt === null;
          return runMicroResearch(asset.symbol, asset.source, {
            providerRouter,
            microInsightStore,
            briefOptions: {
              snapshotStore,
              signalArchive: archive,
              getJintelClient: this.getJintelClient,
              memoryStores: this.memoryStores ?? new Map(),
              profileStore: this.profileStore,
              signalsSince: isFirstRun ? fourDaysAgo : oneDayAgo,
            },
            actionStore: this.actionStore,
            eventLog: this.eventLog,
            notificationBus: this.notificationBus,
          });
        }),
      );

      // Abort if scheduler was reset mid-flight (clear app data)
      if (this.resetGeneration !== gen) {
        logger.info('Micro batch cancelled — scheduler was reset mid-flight');
        return;
      }

      // Update registry timestamps and mark completed today
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const asset = assets[i];
        if (!result || !asset) continue;
        const symbol = asset.symbol;

        if (result.status === 'fulfilled' && result.value.insight) {
          const state = this.microRegistry.get(symbol);
          if (state) {
            state.lastMicroAt = new Date().toISOString();
            state.completedToday = true;
          }

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

      // Trigger macro when all registered assets have completed micro today,
      // but only if the 2-hour cooldown since the last macro has passed.
      // This prevents the reset-flags → micro-completes → immediate-macro loop.
      if (this.allMicrosCompletedToday()) {
        const timeSinceLastMacro = Date.now() - this.lastMacroCompletedAt;
        if (timeSinceLastMacro >= MICRO_TRIGGER_MACRO_COOLDOWN_MS) {
          logger.info('All micro flows completed for all assets — triggering macro flow', {
            assets: this.microRegistry.size,
          });
          void this.runMacroFlow();
        } else {
          const waitMins = Math.ceil((MICRO_TRIGGER_MACRO_COOLDOWN_MS - timeSinceLastMacro) / 60_000);
          logger.debug('All micros done but macro cooldown not elapsed — skipping trigger', {
            waitMins,
          });
        }
      }
    } catch (err) {
      logger.error('Micro research batch failed', { error: err, symbols });
    } finally {
      this.microRunning = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Macro flow — portfolio-wide analysis (assessment + insights + skills + snap)
  // ---------------------------------------------------------------------------

  /**
   * Check if all registered micro assets have completed at least once today.
   */
  private allMicrosCompletedToday(): boolean {
    if (this.microRegistry.size === 0) return false;
    for (const state of this.microRegistry.values()) {
      if (!state.completedToday) return false;
    }
    return true;
  }

  /**
   * Reset daily completion flags — called at the start of each macro run
   * so micro flows can trigger the next macro after a full cycle.
   */
  private resetDailyMicroFlags(): void {
    for (const state of this.microRegistry.values()) {
      state.completedToday = false;
    }
  }

  /**
   * Run the full macro flow:
   *   1. Fetch CLI/RSS/MCP data sources
   *   2. Signal assessment (RA + Strategist via full-curation workflow)
   *   3. ProcessInsights (full multi-agent analysis)
   *   4. Skill evaluation → Actions
   *   5. Snap brief regeneration
   *   6. Reflection sweep
   */
  private async runMacroFlow(): Promise<void> {
    if (this.running) {
      logger.info('Skipping macro flow — already running');
      return;
    }

    // A macro flow consumes ~6 agent runs (RA×2, strategist, risk-mgr, bull, bear).
    // Gate against the daily budget before committing.
    if (!this.checkDailyBudget(6)) return;

    logger.info('Macro flow started — portfolio-wide analysis');
    this.running = true;

    // Reset daily flags so the next micro cycle can trigger another macro
    this.resetDailyMicroFlags();

    // Persist watermark before execution to prevent re-runs on crash
    const state = await this.loadState();
    state.lastRuns['macro-flow'] = new Date().toISOString();
    await this.saveState(state);

    try {
      // 0. Fetch macro economic indicators (GDP, inflation, rates, S&P 500 P/E)
      //    Ingest as MACRO signals before agents analyze — gives the Strategist
      //    real data for the macroContext field in InsightReport.
      try {
        const jintelClient = this.getJintelClient?.();
        if (jintelClient && this.signalIngestor) {
          const macroResult = await fetchMacroIndicators(jintelClient, this.signalIngestor);
          logger.info('Macro indicators fetched', {
            ingested: macroResult.ingested,
            duplicates: macroResult.duplicates,
          });
        }
      } catch (err) {
        logger.warn('Macro indicator fetch failed (continuing macro flow)', { error: err });
      }

      // 1. Signal assessment (RA + Strategist classify signals from archive)
      try {
        await this.orchestrator.execute('full-curation', {});
        logger.info('Signal assessment complete');
      } catch (err) {
        logger.error('Signal assessment failed (continuing macro flow)', { error: err });
      }

      // 2. ProcessInsights (full multi-agent analysis)
      await this.runInsightsWorkflow('Macro flow — portfolio-wide analysis');

      // 3. Skill evaluation → create Actions
      await this.evaluateSkillsAfterCuration();

      // 4. Snap brief regeneration
      await this.regenerateSnap();

      // Mark completion only on success so a failed macro run doesn't start
      // the 2-hour cooldown clock, which would delay the next legitimate run.
      this.lastMacroCompletedAt = Date.now();
      void this.persistBudgetState();
    } catch (err) {
      logger.error('Macro flow failed', { error: err });
    } finally {
      this.running = false;
    }
  }

  /** Single tick — check if the macro flow should fire. */
  private async tick(): Promise<void> {
    if (this.running) return; // Prevent overlapping runs

    try {
      await this.checkMacroSchedule();
    } catch (err) {
      logger.error('Scheduler tick failed', { error: err });
    }
  }

  // ---------------------------------------------------------------------------
  // Macro schedule (every 2 hours)
  // ---------------------------------------------------------------------------

  /**
   * Check if the macro flow should run based on the 2-hour cadence.
   * The macro flow is also triggered by allMicrosCompletedToday().
   */
  private async checkMacroSchedule(): Promise<void> {
    const state = await this.loadState();
    const lastRun = state.lastRuns['macro-flow'];

    if (lastRun) {
      const elapsed = Date.now() - new Date(lastRun).getTime();
      if (elapsed < MACRO_INTERVAL_MS) return;
    }

    await this.runMacroFlow();
  }

  private maybePublishSnap(snap: import('./snap/types.js').Snap): void {
    if (!this.notificationBus) return;

    const hash = snap.contentHash;
    if (hash && hash === this.lastSnapContentHash) return;

    const elapsed = Date.now() - this.lastSnapNotifiedAt;
    if (elapsed < SNAP_NOTIFY_COOLDOWN_MS) return;

    this.lastSnapContentHash = hash;
    this.lastSnapNotifiedAt = Date.now();
    this.notificationBus.publish({ type: 'snap.ready', snapId: snap.id });
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
      const store = this.snapshotStore;
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

      snap.contentHash = snapContentHash(snap);
      await this.snapStore.save(snap);
      logger.info('Snap brief generated from micro insights', { snapId: snap.id, assets: microInsights.size });
      this.maybePublishSnap(snap);
    } catch (err) {
      logger.warn('Failed to generate snap from micro insights', { error: err });
    }
  }

  /**
   * Regenerate the snap brief from the latest insight report.
   * Runs as part of the macro flow.
   */
  private async regenerateSnap(): Promise<void> {
    if (!this.snapStore || !this.insightStore) return;

    try {
      const report = await this.insightStore.getLatest();
      if (!report) return;

      const microInsights = this.microInsightStore ? await this.microInsightStore.getAllLatest() : undefined;
      const snap = snapFromInsight(report, microInsights ? { microInsights } : undefined);
      snap.contentHash = snapContentHash(snap);
      await this.snapStore.save(snap);
      logger.info('Snap brief regenerated', { snapId: snap.id });
      this.maybePublishSnap(snap);

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
    const store = this.snapshotStore;
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
  // Insights — runs as part of the macro flow
  // ---------------------------------------------------------------------------

  /** Execute the process-insights workflow + post-processing (reflection, notifications). */
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

  // ---------------------------------------------------------------------------
  // Config & state I/O
  // ---------------------------------------------------------------------------

  private statePath(): string {
    return join(this.dataRoot, 'cron', 'state.json');
  }

  private async loadState(): Promise<CronState> {
    try {
      const raw = await readFile(this.statePath(), 'utf-8');
      return CronStateSchema.parse(JSON.parse(raw));
    } catch {
      return CronStateSchema.parse({});
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
