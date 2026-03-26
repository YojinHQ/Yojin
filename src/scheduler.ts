/**
 * Lightweight job scheduler — reads digest schedule from alerts.json,
 * checks once per minute, and fires the process-insights workflow daily.
 *
 * State is persisted to data/cron/state.json so restarts don't re-run
 * a job that already fired today.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import type { Orchestrator } from './agents/orchestrator.js';
import { emitProgress } from './agents/orchestrator.js';
import { AlertsConfigSchema } from './config/config.js';
import { createSubsystemLogger } from './logging/logger.js';
import type { ReflectionEngine } from './memory/reflection.js';

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
}

export class Scheduler {
  private readonly orchestrator: Orchestrator;
  private readonly dataRoot: string;
  private readonly checkIntervalMs: number;
  private readonly reflectionEngine?: ReflectionEngine;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(options: SchedulerOptions) {
    this.orchestrator = options.orchestrator;
    this.dataRoot = options.dataRoot;
    this.checkIntervalMs = options.checkIntervalMs ?? 60_000;
    this.reflectionEngine = options.reflectionEngine;
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
      await this.checkInsightsSchedule();
    } catch (err) {
      logger.error('Scheduler tick failed', { error: err });
    } finally {
      this.running = false;
    }
  }

  /** Check if the process-insights workflow should run. */
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
