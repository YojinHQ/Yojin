import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Scheduler, cronMatchesNow, parseDailyCron } from '../src/scheduler.js';

// ---------------------------------------------------------------------------
// parseDailyCron
// ---------------------------------------------------------------------------

describe('parseDailyCron', () => {
  it('parses a valid daily cron expression', () => {
    expect(parseDailyCron('30 7 * * *')).toEqual({ minute: 30, hour: 7 });
  });

  it('parses midnight', () => {
    expect(parseDailyCron('0 0 * * *')).toEqual({ minute: 0, hour: 0 });
  });

  it('parses end of day', () => {
    expect(parseDailyCron('59 23 * * *')).toEqual({ minute: 59, hour: 23 });
  });

  it('returns null for invalid expressions', () => {
    expect(parseDailyCron('invalid')).toBeNull();
    expect(parseDailyCron('')).toBeNull();
    expect(parseDailyCron('60 7 * * *')).toBeNull();
    expect(parseDailyCron('0 24 * * *')).toBeNull();
    expect(parseDailyCron('-1 7 * * *')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cronMatchesNow
// ---------------------------------------------------------------------------

describe('cronMatchesNow', () => {
  it('matches when hour and minute align', () => {
    const now = new Date();
    now.setHours(7, 30, 0, 0);
    expect(cronMatchesNow('30 7 * * *', now)).toBe(true);
  });

  it('does not match on wrong minute', () => {
    const now = new Date();
    now.setHours(7, 31, 0, 0);
    expect(cronMatchesNow('30 7 * * *', now)).toBe(false);
  });

  it('does not match on wrong hour', () => {
    const now = new Date();
    now.setHours(8, 30, 0, 0);
    expect(cronMatchesNow('30 7 * * *', now)).toBe(false);
  });

  it('returns false for invalid cron', () => {
    const now = new Date();
    expect(cronMatchesNow('bad', now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scheduler — integration-style tests with temp directory
// ---------------------------------------------------------------------------

describe('Scheduler', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = join(tmpdir(), `yojin-scheduler-test-${Date.now()}`);
    await mkdir(join(dataRoot, 'config'), { recursive: true });
    await mkdir(join(dataRoot, 'cron'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  function makeOrchestrator(executeMock: ReturnType<typeof vi.fn>) {
    return { execute: executeMock } as unknown as import('../src/agents/orchestrator.js').Orchestrator;
  }

  it('does not fire when no digestSchedule is configured', async () => {
    await writeFile(join(dataRoot, 'config', 'alerts.json'), JSON.stringify({}));

    const execute = vi.fn().mockResolvedValue(new Map());
    const scheduler = new Scheduler({
      orchestrator: makeOrchestrator(execute),
      dataRoot,
      checkIntervalMs: 100_000, // won't fire via interval
    });

    // Access private tick via prototype
    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    expect(execute).not.toHaveBeenCalled();
  });

  it('fires when cron matches current time', async () => {
    const now = new Date();
    const cron = `${now.getMinutes()} ${now.getHours()} * * *`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    await writeFile(
      join(dataRoot, 'config', 'alerts.json'),
      JSON.stringify({
        digestSchedule: { time: `${now.getHours()}:${now.getMinutes()}`, timezone: tz, cron },
      }),
    );

    const execute = vi.fn().mockResolvedValue(new Map());
    const scheduler = new Scheduler({
      orchestrator: makeOrchestrator(execute),
      dataRoot,
      checkIntervalMs: 100_000,
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    expect(execute).toHaveBeenCalledWith('process-insights', {
      message: 'Scheduled daily portfolio insights',
    });
  });

  it('does not fire twice on the same day', async () => {
    const now = new Date();
    const cron = `${now.getMinutes()} ${now.getHours()} * * *`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    await writeFile(
      join(dataRoot, 'config', 'alerts.json'),
      JSON.stringify({
        digestSchedule: { time: `${now.getHours()}:${now.getMinutes()}`, timezone: tz, cron },
      }),
    );

    const execute = vi.fn().mockResolvedValue(new Map());
    const scheduler = new Scheduler({
      orchestrator: makeOrchestrator(execute),
      dataRoot,
      checkIntervalMs: 100_000,
    });

    // First tick — should fire
    await (scheduler as unknown as { tick: () => Promise<void> }).tick();
    expect(execute).toHaveBeenCalledTimes(1);

    // Second tick — should NOT fire (already ran today)
    await (scheduler as unknown as { tick: () => Promise<void> }).tick();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('persists state to cron/state.json', async () => {
    const now = new Date();
    const cron = `${now.getMinutes()} ${now.getHours()} * * *`;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    await writeFile(
      join(dataRoot, 'config', 'alerts.json'),
      JSON.stringify({
        digestSchedule: { time: `${now.getHours()}:${now.getMinutes()}`, timezone: tz, cron },
      }),
    );

    const execute = vi.fn().mockResolvedValue(new Map());
    const scheduler = new Scheduler({
      orchestrator: makeOrchestrator(execute),
      dataRoot,
      checkIntervalMs: 100_000,
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    const stateRaw = await readFile(join(dataRoot, 'cron', 'state.json'), 'utf-8');
    const state = JSON.parse(stateRaw);
    expect(state.lastRuns['process-insights']).toBeDefined();
    expect(new Date(state.lastRuns['process-insights']).getTime()).toBeGreaterThan(0);
  });

  it('start and stop manage the timer', () => {
    const execute = vi.fn().mockResolvedValue(new Map());
    const scheduler = new Scheduler({
      orchestrator: makeOrchestrator(execute),
      dataRoot,
      checkIntervalMs: 100_000,
    });

    scheduler.start();
    // Starting again is a no-op
    scheduler.start();

    scheduler.stop();
    // Stopping again is a no-op
    scheduler.stop();
  });
});
