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

import type { Entity, JintelClient } from '@yojinhq/jintel-client';
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
import type { Signal } from './signals/types.js';
import { buildPortfolioContext } from './skills/portfolio-context-builder.js';
import type { PortfolioContext, SkillEvaluator } from './skills/skill-evaluator.js';
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
  /** Minimum interval between LLM analyses per asset in ms (default: 4h). */
  microLlmIntervalMs?: number;
}

/** Minimum interval between macro flow runs (2 hours). */
const MACRO_INTERVAL_MS = 2 * 60 * 60 * 1000;

/**
 * Minimum interval before micro research can re-trigger a macro flow after
 * one just completed. Prevents the reset-flags → micro-completes → trigger
 * loop that would otherwise fire a macro every ~5 minutes.
 */
const MICRO_TRIGGER_MACRO_COOLDOWN_MS = MACRO_INTERVAL_MS;

/** Default expiry window for actions created from skill triggers. */
const ACTION_EXPIRY_HOURS = 24;

/** Default micro research interval (5 minutes). */
const DEFAULT_MICRO_INTERVAL_MS = 5 * 60 * 1000;

/** Default LLM analysis interval per asset (4 hours). */
const DEFAULT_MICRO_LLM_INTERVAL_MS = 4 * 60 * 60 * 1000;

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
  /** Timestamp of last Jintel signal fetch for this asset (drives rotation). */
  lastMicroAt: string | null;
  /** Timestamp of last LLM analysis for this asset (drives the LLM interval gate). */
  lastLlmAt: string | null;
  /** Whether this asset has completed LLM analysis today. */
  completedToday: boolean;
}

export interface SchedulerAssetStatus {
  symbol: string;
  source: string;
  lastSignalFetchAt: string | null;
  lastLlmAt: string | null;
  nextLlmEligibleAt: string;
  pendingAnalysis: boolean;
}

export interface SchedulerStatus {
  microLlmIntervalHours: number;
  pendingCount: number;
  throttledCount: number;
  assets: SchedulerAssetStatus[];
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
  /** Minimum interval between LLM analyses per asset. Settable at runtime. */
  private microLlmIntervalMs: number;

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
    this.microLlmIntervalMs = options.microLlmIntervalMs ?? DEFAULT_MICRO_LLM_INTERVAL_MS;
  }

  /** Update the LLM analysis interval at runtime (called when user changes setting in UI). */
  setMicroLlmIntervalMs(ms: number): void {
    this.microLlmIntervalMs = ms;
    logger.info('Micro LLM interval updated', { microLlmIntervalMs: ms });
  }

  /** Load persisted macro state into memory on startup. */
  private async hydrateFromState(): Promise<void> {
    try {
      const state = await this.loadState();
      this.lastMacroCompletedAt = state.lastMacroCompletedAt;
    } catch {
      // Start fresh — in-memory defaults are already set
    }
  }

  /** Persist macro watermark into state.json (best-effort). */
  private async persistMacroState(): Promise<void> {
    try {
      const state = await this.loadState();
      state.lastMacroCompletedAt = this.lastMacroCompletedAt;
      await this.saveState(state);
    } catch (err) {
      logger.warn('Failed to persist macro state', { error: err });
    }
  }

  /** Start the scheduler. Checks once per minute + micro tick every 30s. */
  start(): void {
    if (this.timer) return;
    logger.info('Scheduler started', { checkIntervalMs: this.checkIntervalMs, microIntervalMs: this.microIntervalMs });

    // Hydrate persisted macro state so restarts preserve the cooldown watermark
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
        lastLlmAt: null, // force LLM on next eligible tick
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
            this.microRegistry.set(symbol, {
              symbol,
              source: 'portfolio',
              lastMicroAt: null,
              lastLlmAt: null,
              completedToday: false,
            });
          }
        }
      }
    }

    if (this.watchlistStore) {
      for (const entry of this.watchlistStore.list()) {
        const symbol = entry.symbol.toUpperCase();
        if (!this.microRegistry.has(symbol)) {
          this.microRegistry.set(symbol, {
            symbol,
            source: 'watchlist',
            lastMicroAt: null,
            lastLlmAt: null,
            completedToday: false,
          });
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
      // Fetch Jintel signals for these tickers. Use each asset's lastMicroAt as the `since`
      // parameter so restarts only re-fetch since the last known fetch, not the full 7-day window.
      // First-run assets (lastMicroAt === null) fall back to 7 days.
      const jintelClient = this.getJintelClient?.();
      if (jintelClient && this.signalIngestor) {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        // Oldest lastMicroAt across the batch. Any first-run asset forces the full 7d window.
        let since = sevenDaysAgo;
        for (const asset of assets) {
          const t = this.microRegistry.get(asset.symbol)?.lastMicroAt ?? null;
          if (!t) {
            since = sevenDaysAgo;
            break;
          } // first-run asset → use full window
          if (t < since) since = t;
        }
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

      // Capture the pre-fetch lastMicroAt for each asset (used as the signal baseline below),
      // then stamp fetchedAt so symbols rotate out of the due queue on every tick regardless
      // of whether the LLM step runs. Without this stamp, assets with no new signals would
      // re-appear as due immediately, monopolising the batch slots.
      const fetchedAt = new Date().toISOString();
      const preFetchAt = new Map<string, string | null>();
      for (const asset of assets) {
        const state = this.microRegistry.get(asset.symbol);
        if (state) {
          preFetchAt.set(asset.symbol, state.lastMicroAt);
          state.lastMicroAt = fetchedAt;
        }
      }

      // Signal-gate: only run LLM analysis for assets that have new signals since
      // their last micro run. This replaces the blunt daily run counter — we run
      // exactly as many times as there is new data to analyze.
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const assetsWithNewSignals = (
        await Promise.all(
          assets.map(async (asset) => {
            const baseline = preFetchAt.get(asset.symbol) ?? null;
            if (!baseline) return asset; // first run — always analyze
            const fresh = await archive.query({ tickers: [asset.symbol], sinceIngested: baseline, limit: 1 });
            return fresh.length > 0 ? asset : null;
          }),
        )
      ).filter((a): a is (typeof assets)[number] => a !== null);

      if (assetsWithNewSignals.length === 0) {
        logger.debug('Micro research skipped — no new signals for batch', { symbols });
        // Mark all assets as completed today so quiet assets don't block the micro→macro handoff.
        for (const symbol of symbols) {
          const state = this.microRegistry.get(symbol);
          if (state) state.completedToday = true;
        }
        return;
      }

      // LLM interval gate: even when new signals exist, don't re-analyze an asset
      // more often than microLlmIntervalMs. This bounds LLM spend on busy news days.
      const now = Date.now();
      const assetsReadyForLlm = assetsWithNewSignals.filter((asset) => {
        const state = this.microRegistry.get(asset.symbol);
        if (!state?.lastLlmAt) return true; // never analyzed — always eligible
        return now - new Date(state.lastLlmAt).getTime() >= this.microLlmIntervalMs;
      });

      if (assetsReadyForLlm.length === 0) {
        logger.debug('Micro research skipped — LLM interval not elapsed for batch', {
          symbols: assetsWithNewSignals.map((a) => a.symbol),
          microLlmIntervalMs: this.microLlmIntervalMs,
        });
        // Mark all assets with new signals as completed today — they were processed, just throttled.
        for (const asset of assetsWithNewSignals) {
          const state = this.microRegistry.get(asset.symbol);
          if (state) state.completedToday = true;
        }
        return;
      }

      logger.debug('Micro research LLM gate', {
        withNewSignals: assetsWithNewSignals.length,
        readyForLlm: assetsReadyForLlm.length,
        symbols: assetsReadyForLlm.map((a) => a.symbol),
      });

      // Run micro research in parallel (up to MAX_MICRO_CONCURRENCY)
      // Note: getJintelClient/signalIngestor are omitted from the top-level deps
      // (so runMicroResearch won't re-fetch signals per ticker — already batch-fetched above).
      // getJintelClient IS passed in briefOptions so buildSingleBrief can enrich entities
      // for fundamentals, risk, technicals etc. that signals alone don't provide.
      const results = await Promise.allSettled(
        assetsReadyForLlm.map((asset) => {
          const isFirstRun = preFetchAt.get(asset.symbol) === null;
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
        const asset = assetsReadyForLlm[i];
        if (!result || !asset) continue;
        const symbol = asset.symbol;

        if (result.status === 'fulfilled' && result.value.insight) {
          const state = this.microRegistry.get(symbol);
          if (state) {
            state.lastLlmAt = new Date().toISOString();
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

  // ---------------------------------------------------------------------------
  // Status API — exposes per-asset scheduler state for UI visibility
  // ---------------------------------------------------------------------------

  /** Per-asset status returned by getStatus(). */
  getStatus(): SchedulerStatus {
    const now = Date.now();
    const assets: SchedulerAssetStatus[] = [...this.microRegistry.values()].map((state) => {
      const nextLlmEligibleAt = state.lastLlmAt
        ? new Date(new Date(state.lastLlmAt).getTime() + this.microLlmIntervalMs).toISOString()
        : new Date().toISOString();
      // Pending = has new signals fetched (lastMicroAt updated) but LLM hasn't run since
      const pendingAnalysis =
        state.lastMicroAt !== null && (state.lastLlmAt === null || state.lastMicroAt > state.lastLlmAt);
      return {
        symbol: state.symbol,
        source: state.source,
        lastSignalFetchAt: state.lastMicroAt,
        lastLlmAt: state.lastLlmAt,
        nextLlmEligibleAt,
        pendingAnalysis,
      };
    });

    return {
      microLlmIntervalHours: this.microLlmIntervalMs / (60 * 60 * 1000),
      pendingCount: assets.filter((a) => a.pendingAnalysis).length,
      throttledCount: assets.filter((a) => {
        if (!a.lastLlmAt) return false;
        return now - new Date(a.lastLlmAt).getTime() < this.microLlmIntervalMs;
      }).length,
      assets,
    };
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

    // Signal-gate: skip the full Opus pipeline if no signals have arrived since the last macro run.
    // Saves the most expensive part of the pipeline on quiet market days.
    if (this.signalArchive && this.lastMacroCompletedAt > 0) {
      const baseline = new Date(this.lastMacroCompletedAt).toISOString();
      const fresh = await this.signalArchive.query({ sinceIngested: baseline, limit: 1 });
      if (fresh.length === 0) {
        logger.info('Skipping macro flow — no new signals since last run', { lastMacroCompletedAt: baseline });
        return;
      }
    }

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
      void this.persistMacroState();
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
   * If a macro InsightReport exists but micro insights are newer,
   * the snap is still regenerated from micro data so fresh observations surface.
   */
  private async regenerateSnapFromMicro(): Promise<void> {
    if (!this.snapStore || !this.microInsightStore || !this.providerRouter) return;

    try {
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
  /**
   * Fetch live quotes + technicals from Jintel and build a full PortfolioContext.
   * Falls back to snapshot-only context if Jintel is unavailable.
   */
  private async buildEnrichedContext(snapshot: {
    positions: { symbol: string; currentPrice: number; marketValue: number }[];
    totalValue: number;
  }): Promise<PortfolioContext> {
    const tickers = snapshot.positions.map((p) => p.symbol);
    const jintelClient = this.getJintelClient?.();

    if (!jintelClient || tickers.length === 0) {
      return buildPortfolioContext(snapshot, [], []);
    }

    // `since` is a best-effort file-prune hint for the archive (day-partitioned).
    // Record-level 24h filtering happens in the SIGNAL_PRESENT evaluator cutoff.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const signalsP: Promise<Signal[]> = this.signalArchive
      ? this.signalArchive.query({ tickers, since }).catch((err: unknown) => {
          logger.warn('Failed to query signals for skill evaluation', { error: err });
          return [];
        })
      : Promise.resolve([]);

    const [quotesResult, entities, priceHistoryResult, signals] = await Promise.all([
      jintelClient.quotes(tickers).catch((err: unknown) => {
        logger.warn('Failed to fetch quotes for skill evaluation', { error: err });
        return { success: false as const, error: String(err) };
      }),
      this.batchEnrichForSkills(jintelClient, tickers),
      jintelClient.priceHistory(tickers, '1y', '1d').catch((err: unknown) => {
        logger.warn('Failed to fetch price history for skill evaluation', { error: err });
        return { success: false as const, error: String(err) };
      }),
      signalsP,
    ]);

    const quotes = quotesResult.success ? quotesResult.data : [];
    const histories = priceHistoryResult.success ? priceHistoryResult.data : [];

    // Group signals by ticker (one signal can link to multiple assets).
    const signalsByTicker: Record<string, Signal[]> = {};
    for (const sig of signals) {
      for (const link of sig.assets) {
        (signalsByTicker[link.ticker] ??= []).push(sig);
      }
    }

    logger.info('Built enriched PortfolioContext for skill evaluation', {
      tickers: tickers.length,
      quotesAvailable: quotes.length,
      entitiesAvailable: entities.length,
      historiesAvailable: histories.length,
      signalsAvailable: signals.length,
    });

    return buildPortfolioContext(snapshot, quotes, entities, histories, signalsByTicker);
  }

  /** Batch-enrich tickers in chunks of 20, requesting market + technicals + sentiment. */
  private async batchEnrichForSkills(client: JintelClient, tickers: string[]): Promise<Entity[]> {
    const CHUNK_SIZE = 20;
    const results: Entity[] = [];

    for (let i = 0; i < tickers.length; i += CHUNK_SIZE) {
      const chunk = tickers.slice(i, i + CHUNK_SIZE);
      try {
        const result = await client.batchEnrich(chunk, ['market', 'technicals', 'sentiment']);
        if (result.success) {
          results.push(...result.data);
        } else {
          logger.warn('Batch enrich chunk failed', { chunk, error: result.error });
        }
      } catch (err) {
        logger.warn('Batch enrich chunk threw', { chunk, error: err });
      }
    }

    return results;
  }

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

    const context = await this.buildEnrichedContext(snapshot);
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
