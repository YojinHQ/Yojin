/**
 * Scheduler status resolver — exposes per-asset micro research state so the UI
 * can show when LLM analysis is throttled and how long until the next run.
 *
 * Module-level state pattern: setSchedulerStatusProvider() is called once during
 * server startup (run-main.ts) to inject the scheduler.getStatus function.
 */

import type { SchedulerStatus } from '../../../scheduler.js';

// ---------------------------------------------------------------------------
// Module-level state (injected via setter)
// ---------------------------------------------------------------------------

let getSchedulerStatus: (() => SchedulerStatus) | undefined;

export function setSchedulerStatusProvider(fn: () => SchedulerStatus): void {
  getSchedulerStatus = fn;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export function schedulerStatusQuery(): SchedulerStatus {
  if (!getSchedulerStatus) {
    return { microLlmIntervalHours: 4, pendingCount: 0, throttledCount: 0, assets: [] };
  }
  return getSchedulerStatus();
}
