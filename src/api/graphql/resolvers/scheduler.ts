/**
 * Scheduler status resolver — exposes per-asset micro research state so the UI
 * can show when LLM analysis is throttled and how long until the next run.
 *
 * Module-level state pattern: setSchedulerStatusProvider() and setTriggerMicroAnalysis()
 * are called once during server startup (run-main.ts) to inject scheduler callbacks.
 */

import type { SchedulerStatus } from '../../../scheduler.js';

// ---------------------------------------------------------------------------
// Module-level state (injected via setter)
// ---------------------------------------------------------------------------

let getSchedulerStatus: (() => SchedulerStatus) | undefined;
let triggerMicroAnalysisFn: (() => void) | undefined;
let triggerStrategyEvaluationFn: (() => Promise<void>) | undefined;

export function setSchedulerStatusProvider(fn: () => SchedulerStatus): void {
  getSchedulerStatus = fn;
}

export function setTriggerMicroAnalysis(fn: () => void): void {
  triggerMicroAnalysisFn = fn;
}

export function setTriggerStrategyEvaluation(fn: () => Promise<void>): void {
  triggerStrategyEvaluationFn = fn;
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

export function schedulerStatusQuery(): SchedulerStatus {
  if (!getSchedulerStatus) {
    return {
      microLlmIntervalHours: 4,
      pendingCount: 0,
      throttledCount: 0,
      assets: [],
      lastLlmError: null,
      lastLlmErrorAt: null,
      lastLlmSuccessAt: null,
    };
  }
  return getSchedulerStatus();
}

export function triggerMicroAnalysisMutation(): boolean {
  if (!triggerMicroAnalysisFn) return false;
  triggerMicroAnalysisFn();
  return true;
}

export async function triggerStrategyEvaluationMutation(): Promise<boolean> {
  if (!triggerStrategyEvaluationFn) return false;
  await triggerStrategyEvaluationFn();
  return true;
}
