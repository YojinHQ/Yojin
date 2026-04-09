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
let triggerSkillEvaluationFn: (() => Promise<void>) | undefined;

export function setSchedulerStatusProvider(fn: () => SchedulerStatus): void {
  getSchedulerStatus = fn;
}

export function setTriggerMicroAnalysis(fn: () => void): void {
  triggerMicroAnalysisFn = fn;
}

export function setTriggerSkillEvaluation(fn: () => Promise<void>): void {
  triggerSkillEvaluationFn = fn;
}

// ---------------------------------------------------------------------------
// Resolvers
// ---------------------------------------------------------------------------

export function schedulerStatusQuery(): SchedulerStatus {
  if (!getSchedulerStatus) {
    return { microLlmIntervalHours: 4, pendingCount: 0, throttledCount: 0, assets: [] };
  }
  return getSchedulerStatus();
}

export function triggerMicroAnalysisMutation(): boolean {
  if (!triggerMicroAnalysisFn) return false;
  triggerMicroAnalysisFn();
  return true;
}

export async function triggerSkillEvaluationMutation(): Promise<boolean> {
  if (!triggerSkillEvaluationFn) return false;
  await triggerSkillEvaluationFn();
  return true;
}
