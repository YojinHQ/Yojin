import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Scheduler, cronMatchesNow, parseDailyCron } from '../src/scheduler.js';

// Mock fetchMacroIndicators so we can verify it's called in the macro flow.
// Initialize with fn() — vi.mock is hoisted above `const`, so the variable must have a value.
const mockFetchMacroIndicators = vi.fn().mockResolvedValue({ ingested: 5, duplicates: 0 });
vi.mock('../src/jintel/signal-fetcher.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/jintel/signal-fetcher.js')>();
  return {
    ...original,
    fetchMacroIndicators: (...args: unknown[]) => mockFetchMacroIndicators(...args),
  };
});

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

  it('does not fire macro flow when cooldown has not elapsed', async () => {
    // Pre-seed state with a recent macro run
    await writeFile(
      join(dataRoot, 'cron', 'state.json'),
      JSON.stringify({ lastRuns: { 'macro-flow': new Date().toISOString() } }),
    );

    const execute = vi.fn().mockResolvedValue(new Map());
    const scheduler = new Scheduler({
      orchestrator: makeOrchestrator(execute),
      dataRoot,
      checkIntervalMs: 100_000,
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    // Macro should NOT fire — cooldown (2 hours) not elapsed
    expect(execute).not.toHaveBeenCalled();
  });

  it('fires macro flow when 2-hour cooldown has elapsed', async () => {
    // Pre-seed state with a macro run > 2 hours ago
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await writeFile(
      join(dataRoot, 'cron', 'state.json'),
      JSON.stringify({ lastRuns: { 'macro-flow': threeHoursAgo } }),
    );

    const execute = vi.fn().mockResolvedValue(new Map());
    const scheduler = new Scheduler({
      orchestrator: makeOrchestrator(execute),
      dataRoot,
      checkIntervalMs: 100_000,
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    // Macro flow runs full-curation then process-insights
    expect(execute).toHaveBeenCalledWith('full-curation', {});
  });

  it('persists macro-flow state to cron/state.json', async () => {
    // No prior state — macro should fire on first tick
    const execute = vi.fn().mockResolvedValue(new Map());
    const scheduler = new Scheduler({
      orchestrator: makeOrchestrator(execute),
      dataRoot,
      checkIntervalMs: 100_000,
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    // Allow fire-and-forget persistBudgetState() to settle before reading
    await new Promise((r) => setTimeout(r, 200));

    const stateRaw = await readFile(join(dataRoot, 'cron', 'state.json'), 'utf-8');
    const state = JSON.parse(stateRaw);
    expect(state.lastRuns['macro-flow']).toBeDefined();
    expect(new Date(state.lastRuns['macro-flow']).getTime()).toBeGreaterThan(0);
  });

  it('fetches macro indicators during macro flow when Jintel client is available', async () => {
    // Pre-seed state with a macro run > 2 hours ago so the flow fires
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await writeFile(
      join(dataRoot, 'cron', 'state.json'),
      JSON.stringify({ lastRuns: { 'macro-flow': threeHoursAgo } }),
    );

    mockFetchMacroIndicators.mockClear();

    const execute = vi.fn().mockResolvedValue(new Map());
    const fakeJintelClient = {} as import('@yojinhq/jintel-client').JintelClient;
    const fakeIngestor = {} as import('../src/signals/ingestor.js').SignalIngestor;

    const scheduler = new Scheduler({
      orchestrator: makeOrchestrator(execute),
      dataRoot,
      checkIntervalMs: 100_000,
      getJintelClient: () => fakeJintelClient,
      signalIngestor: fakeIngestor,
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    expect(mockFetchMacroIndicators).toHaveBeenCalledOnce();
    expect(mockFetchMacroIndicators).toHaveBeenCalledWith(fakeJintelClient, fakeIngestor);
  });

  it('skips macro indicators when Jintel client is not available', async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await writeFile(
      join(dataRoot, 'cron', 'state.json'),
      JSON.stringify({ lastRuns: { 'macro-flow': threeHoursAgo } }),
    );

    mockFetchMacroIndicators.mockClear();

    const execute = vi.fn().mockResolvedValue(new Map());
    const scheduler = new Scheduler({
      orchestrator: makeOrchestrator(execute),
      dataRoot,
      checkIntervalMs: 100_000,
      // No getJintelClient or signalIngestor
    });

    await (scheduler as unknown as { tick: () => Promise<void> }).tick();

    expect(mockFetchMacroIndicators).not.toHaveBeenCalled();
    // Macro flow should still run (signal assessment)
    expect(execute).toHaveBeenCalledWith('full-curation', {});
  });

  it('start and stop manage the timer', async () => {
    // Pre-seed state so tick() doesn't trigger async macro flow
    await writeFile(
      join(dataRoot, 'cron', 'state.json'),
      JSON.stringify({ lastRuns: { 'macro-flow': new Date().toISOString() } }),
    );

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
