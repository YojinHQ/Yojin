import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ToolDefinition } from '../../src/core/types.js';
import { SignalArchive } from '../../src/signals/archive.js';
import { createSignalTools } from '../../src/signals/tools.js';
import type { Signal, SignalType } from '../../src/signals/types.js';

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig-001',
    contentHash: 'hash-001',
    type: 'FUNDAMENTAL',
    title: 'AAPL Market Snapshot',
    assets: [{ ticker: 'AAPL', relevance: 1, linkType: 'DIRECT' }],
    sources: [{ id: 'jintel', name: 'Jintel', type: 'API', reliability: 0.9 }],
    publishedAt: new Date().toISOString(),
    ingestedAt: new Date().toISOString(),
    confidence: 0.9,
    outputType: 'INSIGHT',
    version: 1,
    ...overrides,
  };
}

describe('grep_signals — default since clamping', () => {
  let dir: string;
  let archive: SignalArchive;
  let grepSignals: ToolDefinition;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yojin-tools-'));
    archive = new SignalArchive({ dir });
    const tools = createSignalTools({ archive });
    grepSignals = tools.find((t) => t.name === 'grep_signals')!;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seedOldAndFresh(type: SignalType, oldDays: number): Promise<void> {
    const oldTs = new Date(Date.now() - oldDays * 24 * 60 * 60 * 1000).toISOString();
    const freshTs = new Date().toISOString();
    await archive.appendBatch([
      makeSignal({
        id: 'old',
        contentHash: 'h-old',
        type,
        title: `Old ${type}`,
        publishedAt: oldTs,
        ingestedAt: oldTs,
      }),
      makeSignal({
        id: 'fresh',
        contentHash: 'h-fresh',
        type,
        title: `Fresh ${type}`,
        publishedAt: freshTs,
        ingestedAt: freshTs,
      }),
    ]);
  }

  it('clamps FUNDAMENTAL to 7d when since is omitted', async () => {
    await seedOldAndFresh('FUNDAMENTAL', 30);
    const result = await grepSignals.execute({ type: 'FUNDAMENTAL', limit: 20 });
    expect(result.content).toContain('fresh');
    expect(result.content).not.toContain('old');
  });

  it('clamps TECHNICAL to 7d when since is omitted', async () => {
    await seedOldAndFresh('TECHNICAL', 14);
    const result = await grepSignals.execute({ type: 'TECHNICAL', limit: 20 });
    expect(result.content).toContain('fresh');
    expect(result.content).not.toContain('old');
  });

  it('clamps NEWS to 3d when since is omitted', async () => {
    await seedOldAndFresh('NEWS', 7);
    const result = await grepSignals.execute({ type: 'NEWS', limit: 20 });
    expect(result.content).toContain('fresh');
    expect(result.content).not.toContain('old');
  });

  it('does not clamp MACRO signals — returns full history', async () => {
    await seedOldAndFresh('MACRO', 60);
    const result = await grepSignals.execute({ type: 'MACRO', limit: 20 });
    expect(result.content).toContain('fresh');
    expect(result.content).toContain('old');
  });

  it('explicit since overrides the default clamp', async () => {
    await seedOldAndFresh('FUNDAMENTAL', 30);
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const result = await grepSignals.execute({ type: 'FUNDAMENTAL', since, limit: 20 });
    expect(result.content).toContain('fresh');
    expect(result.content).toContain('old');
  });
});
