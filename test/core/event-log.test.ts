import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EventLog } from '../../src/core/event-log.js';

describe('EventLog', () => {
  let log: EventLog;
  let testDir: string;
  let logFile: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `yojin-test-events-${Date.now()}`);
    logFile = join(testDir, 'events.jsonl');
    log = new EventLog(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('auto-creates the event log directory', async () => {
    await log.append({ type: 'test.event', data: {} });
    expect(existsSync(testDir)).toBe(true);
  });

  it('appends an event and returns it with id and timestamp', async () => {
    const entry = await log.append({ type: 'agent.started', data: { agentId: 'research' } });
    expect(entry.id).toBeDefined();
    expect(entry.type).toBe('agent.started');
    expect(entry.timestamp).toBeDefined();
    expect(entry.data).toEqual({ agentId: 'research' });
  });

  it('persists events to JSONL file', async () => {
    await log.append({ type: 'tool.executed', data: { tool: 'get_time' } });
    await log.append({ type: 'session.created', data: { sessionId: 's1' } });

    const content = await readFile(logFile, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('tool.executed');
  });

  it('stores events in ring buffer for fast reads', async () => {
    await log.append({ type: 'event.one', data: {} });
    await log.append({ type: 'event.two', data: {} });

    const recent = await log.recent(10);
    expect(recent).toHaveLength(2);
    expect(recent[0].type).toBe('event.one');
    expect(recent[1].type).toBe('event.two');
  });

  it('ring buffer caps at configured size', async () => {
    const smallLog = new EventLog(testDir, { bufferSize: 3 });

    for (let i = 0; i < 5; i++) {
      await smallLog.append({ type: `event.${i}`, data: {} });
    }

    const recent = await smallLog.recent(10);
    expect(recent).toHaveLength(3);
    expect(recent[0].type).toBe('event.2');
    expect(recent[1].type).toBe('event.3');
    expect(recent[2].type).toBe('event.4');
  });

  it('queries by event type', async () => {
    await log.append({ type: 'tool.executed', data: { tool: 'a' } });
    await log.append({ type: 'session.created', data: {} });
    await log.append({ type: 'tool.executed', data: { tool: 'b' } });

    const results = await log.query({ type: 'tool.executed' });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.type === 'tool.executed')).toBe(true);
  });

  it('queries by custom predicate', async () => {
    await log.append({ type: 'tool.executed', data: { tool: 'get_time' } });
    await log.append({ type: 'tool.executed', data: { tool: 'calculate' } });

    const results = await log.query({
      predicate: (e) => (e.data as { tool: string }).tool === 'calculate',
    });
    expect(results).toHaveLength(1);
  });

  it('queries by time range', async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    await log.append({ type: 'event.a', data: {} });
    const after = new Date(Date.now() + 1000).toISOString();

    const results = await log.query({ since: before, until: after });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.every((e) => e.type === 'event.a')).toBe(true);
  });

  it('recent returns last N events', async () => {
    for (let i = 0; i < 10; i++) {
      await log.append({ type: `event.${i}`, data: {} });
    }

    const last3 = await log.recent(3);
    expect(last3).toHaveLength(3);
    expect(last3[0].type).toBe('event.7');
  });

  it('defaults data to empty object when omitted', async () => {
    const entry = await log.append({ type: 'simple.event' });
    expect(entry.data).toEqual({});
  });

  it('warms buffer from existing JSONL on construction', async () => {
    await mkdir(testDir, { recursive: true });
    const events = [
      { id: 'e1', type: 'old.event', timestamp: '2026-03-17T00:00:00Z', data: {} },
      { id: 'e2', type: 'old.event2', timestamp: '2026-03-17T00:01:00Z', data: {} },
    ];
    await writeFile(logFile, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

    const warmedLog = new EventLog(testDir);
    await warmedLog.initialize();

    const recent = await warmedLog.recent(10);
    expect(recent).toHaveLength(2);
    expect(recent[0].type).toBe('old.event');
  });

  it('rejects events with missing type', async () => {
    // @ts-expect-error — testing runtime validation
    await expect(log.append({ data: {} })).rejects.toThrow();
  });
});
