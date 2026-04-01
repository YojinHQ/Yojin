import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SignalArchive } from '../../src/signals/archive.js';
import { SignalIngestor } from '../../src/signals/ingestor.js';
import type { RawSignalInput } from '../../src/signals/ingestor.js';
import { QualityAgent } from '../../src/signals/quality-agent.js';

function makeInput(overrides: Partial<RawSignalInput> = {}): RawSignalInput {
  return {
    sourceId: 'test-source',
    sourceName: 'Test Source',
    sourceType: 'API',
    reliability: 0.9,
    title: 'Test signal title',
    publishedAt: '2026-03-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('SignalIngestor', () => {
  let dir: string;
  let archive: SignalArchive;
  let ingestor: SignalIngestor;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'yojin-ingestor-'));
    archive = new SignalArchive({ dir });
    ingestor = new SignalIngestor({ archive });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('ingests raw items into the archive', async () => {
    const result = await ingestor.ingest([makeInput()]);
    expect(result.ingested).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(result.errors).toHaveLength(0);

    const signals = await archive.query({});
    expect(signals).toHaveLength(1);
    expect(signals[0].title).toBe('Test signal title');
  });

  it('deduplicates by content hash', async () => {
    const input = makeInput();
    const result1 = await ingestor.ingest([input]);
    expect(result1.ingested).toBe(1);

    const result2 = await ingestor.ingest([input]);
    expect(result2.ingested).toBe(0);
    expect(result2.duplicates).toBe(1);

    const signals = await archive.query({});
    expect(signals).toHaveLength(1);
  });

  it('extracts tickers from content', async () => {
    const result = await ingestor.ingest([
      makeInput({
        title: '$AAPL and $TSLA mentioned',
        content: 'Apple and Tesla both reported strong earnings',
      }),
    ]);
    expect(result.ingested).toBe(1);

    const signals = await archive.query({});
    const tickers = signals[0].assets.map((a) => a.ticker);
    expect(tickers).toContain('AAPL');
    expect(tickers).toContain('TSLA');
  });

  it('uses explicit tickers when provided', async () => {
    const result = await ingestor.ingest([makeInput({ tickers: ['MSFT', 'GOOG'] })]);
    expect(result.ingested).toBe(1);

    const signals = await archive.query({});
    const tickers = signals[0].assets.map((a) => a.ticker);
    expect(tickers).toEqual(['MSFT', 'GOOG']);
  });

  it('uses explicit signal type when provided', async () => {
    await ingestor.ingest([makeInput({ type: 'MACRO' })]);

    const signals = await archive.query({});
    expect(signals[0].type).toBe('MACRO');
  });

  it('auto-classifies MACRO type from content', async () => {
    await ingestor.ingest([makeInput({ title: 'Federal Reserve holds interest rates steady' })]);

    const signals = await archive.query({});
    expect(signals[0].type).toBe('MACRO');
  });

  it('auto-classifies FUNDAMENTAL type from content', async () => {
    await ingestor.ingest([makeInput({ title: 'AAPL earnings beat expectations, revenue up 15%' })]);

    const signals = await archive.query({});
    expect(signals[0].type).toBe('FUNDAMENTAL');
  });

  it('auto-classifies SENTIMENT type from content', async () => {
    await ingestor.ingest([makeInput({ title: 'Bullish sentiment surges on Reddit for GME' })]);

    const signals = await archive.query({});
    expect(signals[0].type).toBe('SENTIMENT');
  });

  it('auto-classifies TECHNICAL type from content', async () => {
    await ingestor.ingest([makeInput({ title: 'AAPL breaks above 200-day moving average with RSI at 65' })]);

    const signals = await archive.query({});
    expect(signals[0].type).toBe('TECHNICAL');
  });

  it('defaults to NEWS for unclassified content', async () => {
    await ingestor.ingest([makeInput({ title: 'Company announces new product launch' })]);

    const signals = await archive.query({});
    expect(signals[0].type).toBe('NEWS');
  });

  it('skips items without a title', async () => {
    const result = await ingestor.ingest([makeInput({ title: '' }), makeInput({ title: 'Valid title' })]);
    expect(result.ingested).toBe(1);
  });

  it('skips items with invalid dates', async () => {
    const result = await ingestor.ingest([
      makeInput({ publishedAt: 'not-a-date' }),
      makeInput({ title: 'Valid signal', publishedAt: '2026-03-21T11:00:00.000Z' }),
    ]);
    expect(result.ingested).toBe(1);
  });

  it('stores source provenance on the signal', async () => {
    await ingestor.ingest([
      makeInput({
        sourceId: 'web-search',
        sourceName: 'Web Search',
        sourceType: 'API',
        reliability: 0.95,
      }),
    ]);

    const signals = await archive.query({});
    expect(signals[0].sources).toHaveLength(1);
    expect(signals[0].sources[0].id).toBe('web-search');
    expect(signals[0].sources[0].name).toBe('Web Search');
    expect(signals[0].sources[0].reliability).toBe(0.95);
  });

  it('stores link in metadata', async () => {
    await ingestor.ingest([makeInput({ link: 'https://example.com/article' })]);

    const signals = await archive.query({});
    expect(signals[0].metadata?.link).toBe('https://example.com/article');
  });

  it('omits metadata when no metadata or link is provided', async () => {
    await ingestor.ingest([makeInput()]);

    const signals = await archive.query({});
    expect(signals[0].metadata).toBeUndefined();
  });

  it('loads existing hashes from archive on initialization', async () => {
    // Pre-populate
    const ingestor1 = new SignalIngestor({ archive });
    await ingestor1.ingest([makeInput()]);

    // New ingestor should dedup against existing archive
    const ingestor2 = new SignalIngestor({ archive });
    const result = await ingestor2.ingest([makeInput()]);
    expect(result.duplicates).toBe(1);
    expect(result.ingested).toBe(0);
  });

  describe('quality agent filtering', () => {
    function makeQualityAgent(
      overrides: Partial<{
        verdict: 'KEEP' | 'DROP';
        dropReason: string;
        qualityScore: number;
      }> = {},
    ): QualityAgent {
      const { verdict = 'KEEP', dropReason, qualityScore = 75 } = overrides;
      const response = JSON.stringify({
        tier1: 'Test headline',
        tier2: 'Test summary for the signal.',
        sentiment: 'NEUTRAL',
        isUrgent: false,
        verdict,
        dropReason: dropReason ?? null,
        qualityScore,
        duplicateOf: null,
      });
      return new QualityAgent({ complete: async () => response });
    }

    it('drops signals flagged as false matches', async () => {
      ingestor.setQualityAgent(makeQualityAgent({ verdict: 'DROP', dropReason: 'false_match', qualityScore: 10 }));

      const result = await ingestor.ingest([
        makeInput({ title: 'Apple Music page for song lyrics', tickers: ['AXTI'] }),
      ]);

      expect(result.ingested).toBe(1);
      const signals = await archive.query({});
      expect(signals).toHaveLength(0);
    });

    it('drops signals with quality score below threshold', async () => {
      ingestor.setQualityAgent(makeQualityAgent({ qualityScore: 20 }));

      const result = await ingestor.ingest([makeInput({ title: 'Generic market chatter with no impact' })]);

      expect(result.ingested).toBe(1);
      const signals = await archive.query({});
      expect(signals).toHaveLength(0);
    });

    it('keeps signals with quality score at threshold', async () => {
      ingestor.setQualityAgent(makeQualityAgent({ qualityScore: 40 }));

      const result = await ingestor.ingest([makeInput({ title: 'Moderate relevance market signal' })]);

      expect(result.ingested).toBe(1);
      const signals = await archive.query({});
      expect(signals).toHaveLength(1);
    });

    it('keeps high-quality signals', async () => {
      ingestor.setQualityAgent(makeQualityAgent({ qualityScore: 85 }));

      const result = await ingestor.ingest([makeInput({ title: 'AAPL earnings beat by 15%', tickers: ['AAPL'] })]);

      expect(result.ingested).toBe(1);
      const signals = await archive.query({});
      expect(signals).toHaveLength(1);
      expect(signals[0].tier1).toBe('Test headline');
    });

    it('does not filter signals without a quality agent', async () => {
      // No quality agent wired — signals pass through raw
      const result = await ingestor.ingest([makeInput({ title: 'Signal without LLM enrichment' })]);

      expect(result.ingested).toBe(1);
      const signals = await archive.query({});
      expect(signals).toHaveLength(1);
      expect(signals[0].tier1).toBeUndefined();
    });
  });
});
