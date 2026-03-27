/**
 * Lightweight job scheduler — runs curation every 15 minutes and
 * optionally fires the process-insights workflow on a daily cron schedule.
 *
 * State is persisted to data/cron/state.json so restarts don't re-run
 * a job that already fired within its cooldown window.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import type { ActionStore } from './actions/action-store.js';
import type { Orchestrator } from './agents/orchestrator.js';
import { emitProgress } from './agents/orchestrator.js';
import { AlertsConfigSchema } from './config/config.js';
import { createSubsystemLogger } from './logging/logger.js';
import type { ReflectionEngine } from './memory/reflection.js';
import type { PortfolioSnapshotStore } from './portfolio/snapshot-store.js';
import type { SignalArchive } from './signals/archive.js';
import type { CuratedSignalStore } from './signals/curation/curated-signal-store.js';
import { runCurationPipeline } from './signals/curation/pipeline.js';
import type { CurationConfig } from './signals/curation/types.js';
import type { SkillEvaluator } from './skills/skill-evaluator.js';

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
}

/** Minimum interval between curation runs (15 minutes). */
const CURATION_INTERVAL_MS = 15 * 60 * 1000;

/** Default expiry window for actions created from skill triggers. */
const ACTION_EXPIRY_HOURS = 24;

export class Scheduler {
  private readonly orchestrator: Orchestrator;
  private readonly dataRoot: string;
  private readonly checkIntervalMs: number;
  private readonly reflectionEngine?: ReflectionEngine;
  private readonly curationPipeline?: SchedulerOptions['curationPipeline'];
  private readonly skillEvaluator?: SkillEvaluator;
  private readonly actionStore?: ActionStore;
  private readonly snapshotStore?: PortfolioSnapshotStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(options: SchedulerOptions) {
    this.orchestrator = options.orchestrator;
    this.dataRoot = options.dataRoot;
    this.checkIntervalMs = options.checkIntervalMs ?? 60_000;
    this.reflectionEngine = options.reflectionEngine;
    this.curationPipeline = options.curationPipeline;
    this.skillEvaluator = options.skillEvaluator;
    this.actionStore = options.actionStore;
    this.snapshotStore = options.snapshotStore;
  }

  /** Start the scheduler. Checks once per minute. */
  start(): void {
    if (this.timer) return;
    logger.info('Scheduler started', { checkIntervalMs: this.checkIntervalMs });

    // Check immediately on start, then at interval
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.checkIntervalMs);
  }

  /** Stop the scheduler. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Scheduler stopped');
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

    logger.info('Triggering scheduled curation pipeline');

    // Persist the watermark before execution to prevent re-runs on crash
    state.lastRuns['run-curation'] = new Date().toISOString();
    await this.saveState(state);

    try {
      const result = await runCurationPipeline(this.curationPipeline);

      logger.info('Scheduled curation complete', {
        signalsProcessed: result.signalsProcessed,
        signalsCurated: result.signalsCurated,
        durationMs: result.durationMs,
      });

      // Evaluate active skills after curation
      await this.evaluateSkillsAfterCuration();
    } catch (err) {
      logger.error('Scheduled curation failed', { error: err });
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
      } else {
        logger.warn('Failed to create action from skill trigger', {
          error: result.error,
          skillId: evaluation.skillId,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Insights schedule (daily cron — available for manual/skill-triggered use)
  // ---------------------------------------------------------------------------

  /**
   * Check if the process-insights workflow should run.
   *
   * NOTE: This runs on a daily cron schedule from alerts.json. It is also
   * available for manual or skill-triggered invocation via the orchestrator.
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

    // Fire the workflow
    logger.info('Triggering scheduled process-insights workflow', {
      cron,
      timezone,
      time: now.toISOString(),
    });

    emitProgress({
      workflowId: 'process-insights',
      stage: 'activity',
      message: 'Scheduled daily insights processing starting...',
      timestamp: new Date().toISOString(),
    });

    // Persist attempt before executing so a crash/retry can't re-fire the same day
    state.lastRuns['process-insights'] = new Date().toISOString();
    await this.saveState(state);

    try {
      await this.orchestrator.execute('process-insights', {
        message: 'Scheduled daily portfolio insights',
      });

      logger.info('Scheduled process-insights completed');

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
      logger.error('Scheduled process-insights failed', { error: err });
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
