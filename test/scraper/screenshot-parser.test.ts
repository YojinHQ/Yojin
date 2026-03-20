import { describe, expect, it, vi } from 'vitest';

import type { AgentLoopProvider } from '../../src/core/types.js';
import { ScreenshotConnector } from '../../src/scraper/platforms/screenshot-connector.js';
import {
  buildExtractionPrompt,
  computeConfidence,
  extractJsonFromResponse,
  parsePortfolioScreenshot,
} from '../../src/scraper/screenshot-parser.js';
import {
  AssetClassSchema,
  type ExtractedPosition,
  ExtractedPositionSchema,
  ExtractionResponseSchema,
  PlatformSchema,
} from '../../src/scraper/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockProvider(responseText: string): AgentLoopProvider {
  return {
    completeWithTools: vi.fn(async () => ({
      content: [{ type: 'text' as const, text: responseText }],
      stopReason: 'end_turn',
      usage: { inputTokens: 1000, outputTokens: 500 },
    })),
  };
}

function mockErrorProvider(error: string): AgentLoopProvider {
  return {
    completeWithTools: vi.fn(async () => {
      throw new Error(error);
    }),
  };
}

const VALID_RESPONSE = JSON.stringify({
  platform: 'COINBASE',
  positions: [
    {
      symbol: 'BTC',
      name: 'Bitcoin',
      quantity: 0.5,
      costBasis: 29000,
      currentPrice: 67234,
      marketValue: 33617,
      unrealizedPnl: 4617,
      unrealizedPnlPercent: 15.9,
      assetClass: 'CRYPTO',
    },
    {
      symbol: 'ETH',
      name: 'Ethereum',
      quantity: 12,
      currentPrice: 3456,
      marketValue: 41472,
      assetClass: 'CRYPTO',
    },
  ],
});

const DUMMY_IMAGE = Buffer.from('fake-image-data');

// ---------------------------------------------------------------------------
// extractJsonFromResponse
// ---------------------------------------------------------------------------

describe('extractJsonFromResponse', () => {
  it('parses raw JSON', () => {
    const result = extractJsonFromResponse('{"platform":"COINBASE","positions":[]}');
    expect(result).toEqual({ platform: 'COINBASE', positions: [] });
  });

  it('parses markdown-fenced JSON', () => {
    const text = 'Here is the data:\n```json\n{"platform":"ROBINHOOD","positions":[]}\n```';
    const result = extractJsonFromResponse(text);
    expect(result).toEqual({ platform: 'ROBINHOOD', positions: [] });
  });

  it('parses fenced JSON without language tag', () => {
    const text = '```\n{"platform":"MANUAL","positions":[]}\n```';
    const result = extractJsonFromResponse(text);
    expect(result).toEqual({ platform: 'MANUAL', positions: [] });
  });

  it('extracts JSON object embedded in text', () => {
    const text = 'I found the following:\n{"platform":"COINBASE","positions":[{"symbol":"BTC"}]}\nEnd of data.';
    const result = extractJsonFromResponse(text);
    expect(result).toEqual({ platform: 'COINBASE', positions: [{ symbol: 'BTC' }] });
  });

  it('returns null for non-JSON text', () => {
    expect(extractJsonFromResponse('No JSON here at all')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(extractJsonFromResponse('{invalid json}')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeConfidence
// ---------------------------------------------------------------------------

describe('computeConfidence', () => {
  it('returns high confidence for a fully populated position', () => {
    const positions: ExtractedPosition[] = [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        quantity: 10,
        costBasis: 150,
        currentPrice: 175,
        marketValue: 1750,
        unrealizedPnl: 250,
        unrealizedPnlPercent: 16.67,
        assetClass: 'EQUITY',
      },
    ];
    const { overall, perPosition } = computeConfidence(positions);
    expect(overall).toBe(1);
    expect(perPosition[0].fieldsExtracted).toBe(8);
    expect(perPosition[0].consistencyCheck).toBe(true);
  });

  it('returns lower confidence for a partial position', () => {
    const positions: ExtractedPosition[] = [
      {
        symbol: 'BTC',
        currentPrice: 67000,
      },
    ];
    const { overall, perPosition } = computeConfidence(positions);
    expect(overall).toBeLessThan(0.5);
    expect(perPosition[0].fieldsExtracted).toBe(1);
    expect(perPosition[0].consistencyCheck).toBe(true); // Can't check, assumed true
  });

  it('fails consistency check when values are inconsistent', () => {
    const positions: ExtractedPosition[] = [
      {
        symbol: 'TSLA',
        name: 'Tesla',
        quantity: 10,
        currentPrice: 250,
        marketValue: 5000, // Should be 2500, way off
        unrealizedPnl: 100,
        unrealizedPnlPercent: 5,
        costBasis: 240,
      },
    ];
    const { perPosition } = computeConfidence(positions);
    expect(perPosition[0].consistencyCheck).toBe(false);
    expect(perPosition[0].confidence).toBe(0.61); // 7/8 completeness * 0.7 + 0 consistency * 0.3
  });

  it('passes consistency check within tolerance', () => {
    const positions: ExtractedPosition[] = [
      {
        symbol: 'GOOG',
        quantity: 5,
        currentPrice: 150,
        marketValue: 748, // 5 * 150 = 750, diff = 0.27%, within 5%
      },
    ];
    const { perPosition } = computeConfidence(positions);
    expect(perPosition[0].consistencyCheck).toBe(true);
  });

  it('returns 0 overall for empty array', () => {
    const { overall } = computeConfidence([]);
    expect(overall).toBe(0);
  });

  it('averages confidence across multiple positions', () => {
    const positions: ExtractedPosition[] = [
      {
        symbol: 'BTC',
        name: 'Bitcoin',
        quantity: 1,
        costBasis: 30000,
        currentPrice: 67000,
        marketValue: 67000,
        unrealizedPnl: 37000,
        unrealizedPnlPercent: 123,
        assetClass: 'CRYPTO',
      },
      {
        symbol: 'DOGE',
        currentPrice: 0.15,
      },
    ];
    const { overall, perPosition } = computeConfidence(positions);
    expect(perPosition[0].confidence).toBe(1); // Full + consistent
    expect(perPosition[1].confidence).toBeLessThan(0.5); // Partial
    expect(overall).toBeGreaterThan(0.5);
    expect(overall).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// buildExtractionPrompt
// ---------------------------------------------------------------------------

describe('buildExtractionPrompt', () => {
  it('includes platform hint when provided', () => {
    const prompt = buildExtractionPrompt('COINBASE');
    expect(prompt).toContain('COINBASE');
    expect(prompt).toContain('user indicated');
  });

  it('asks for platform detection when no hint', () => {
    const prompt = buildExtractionPrompt();
    expect(prompt).toContain('Identify the platform');
  });
});

// ---------------------------------------------------------------------------
// parsePortfolioScreenshot
// ---------------------------------------------------------------------------

describe('parsePortfolioScreenshot', () => {
  it('successfully parses a valid vision response', async () => {
    const provider = mockProvider(VALID_RESPONSE);

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.positions).toHaveLength(2);
    expect(result.positions[0].symbol).toBe('BTC');
    expect(result.positions[1].symbol).toBe('ETH');
    expect(result.metadata.platform).toBe('COINBASE');
    expect(result.metadata.source).toBe('SCREENSHOT');
    expect(result.metadata.confidence).toBeGreaterThan(0);
    expect(result.metadata.usage).toEqual({ inputTokens: 1000, outputTokens: 500 });
  });

  it('sends image as base64 in the message', async () => {
    const provider = mockProvider(VALID_RESPONSE);

    await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/jpeg',
      provider,
      model: 'claude-sonnet-4-6',
    });

    const call = vi.mocked(provider.completeWithTools).mock.calls[0][0];
    const userMessage = call.messages[0];
    expect(Array.isArray(userMessage.content)).toBe(true);

    const blocks = userMessage.content as Array<{ type: string; source?: unknown }>;
    const imageBlock = blocks.find((b) => b.type === 'image');
    expect(imageBlock).toBeDefined();
    expect(imageBlock!.source).toEqual({
      type: 'base64',
      media_type: 'image/jpeg',
      data: DUMMY_IMAGE.toString('base64'),
    });
  });

  it('returns failure when provider throws', async () => {
    const provider = mockErrorProvider('API rate limited');

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('Vision API call failed');
    expect(result.error).toContain('API rate limited');
  });

  it('returns failure for non-JSON response', async () => {
    const provider = mockProvider('I cannot read this image clearly.');

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('Could not extract JSON');
  });

  it('returns failure for invalid JSON structure', async () => {
    const provider = mockProvider(JSON.stringify({ platform: 'COINBASE' })); // missing positions

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('Validation failed');
  });

  it('returns failure for empty response', async () => {
    const provider = mockProvider('');

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('empty response');
  });

  it('includes warnings for incomplete positions', async () => {
    const response = JSON.stringify({
      platform: 'ROBINHOOD',
      positions: [{ symbol: 'SOL', currentPrice: 150 }],
      notes: 'Could not read cost basis for SOL',
    });
    const provider = mockProvider(response);

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.metadata.warnings).toContain('Could not read cost basis for SOL');
    expect(result.metadata.warnings.some((w) => w.includes('Incomplete data for SOL'))).toBe(true);
  });

  it('passes platform hint to the prompt', async () => {
    const provider = mockProvider(VALID_RESPONSE);

    await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
      platformHint: 'INTERACTIVE_BROKERS',
    });

    const call = vi.mocked(provider.completeWithTools).mock.calls[0][0];
    const blocks = call.messages[0].content as Array<{ type: string; text?: string }>;
    const textBlock = blocks.find((b) => b.type === 'text');
    expect(textBlock?.text).toContain('INTERACTIVE BROKERS');
  });

  it('handles markdown-fenced JSON from vision', async () => {
    const fenced = '```json\n' + VALID_RESPONSE + '\n```';
    const provider = mockProvider(fenced);

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.positions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// ScreenshotConnector
// ---------------------------------------------------------------------------

describe('ScreenshotConnector', () => {
  it('delegates fetchPositions to parsePortfolioScreenshot', async () => {
    const provider = mockProvider(VALID_RESPONSE);
    const connector = new ScreenshotConnector({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(connector.platformId).toBe('MANUAL');
    expect(connector.platformName).toBe('MANUAL Screenshot Import');

    const result = await connector.fetchPositions();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.positions).toHaveLength(2);
  });

  it('returns failure when provider errors', async () => {
    const provider = mockErrorProvider('Network error');
    const connector = new ScreenshotConnector({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    const result = await connector.fetchPositions();
    expect(result.success).toBe(false);
  });

  it('passes platform hint through to parser', async () => {
    const provider = mockProvider(VALID_RESPONSE);
    const connector = new ScreenshotConnector({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/jpeg',
      provider,
      model: 'claude-sonnet-4-6',
      platformHint: 'ROBINHOOD',
    });

    await connector.fetchPositions();

    const call = vi.mocked(provider.completeWithTools).mock.calls[0][0];
    const blocks = call.messages[0].content as Array<{ type: string; text?: string }>;
    const textBlock = blocks.find((b) => b.type === 'text');
    expect(textBlock?.text).toContain('ROBINHOOD');
  });

  it('implements TieredPlatformConnector — tier is SCREENSHOT', () => {
    const connector = new ScreenshotConnector({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider: mockProvider(VALID_RESPONSE),
      model: 'claude-sonnet-4-6',
    });
    expect(connector.tier).toBe('SCREENSHOT');
  });

  it('isAvailable always returns true', async () => {
    const connector = new ScreenshotConnector({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider: mockProvider(VALID_RESPONSE),
      model: 'claude-sonnet-4-6',
    });
    expect(await connector.isAvailable()).toBe(true);
  });

  it('connect returns success', async () => {
    const connector = new ScreenshotConnector({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider: mockProvider(VALID_RESPONSE),
      model: 'claude-sonnet-4-6',
    });
    const result = await connector.connect([]);
    expect(result).toEqual({ success: true });
  });

  it('disconnect is a no-op', async () => {
    const connector = new ScreenshotConnector({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider: mockProvider(VALID_RESPONSE),
      model: 'claude-sonnet-4-6',
    });
    await expect(connector.disconnect()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

describe('Zod schemas', () => {
  describe('PlatformSchema', () => {
    it('accepts valid platforms', () => {
      for (const p of [
        'COINBASE',
        'ROBINHOOD',
        'INTERACTIVE_BROKERS',
        'SCHWAB',
        'BINANCE',
        'FIDELITY',
        'POLYMARKET',
        'PHANTOM',
        'MANUAL',
      ]) {
        expect(PlatformSchema.parse(p)).toBe(p);
      }
    });

    it('accepts custom platform strings', () => {
      expect(PlatformSchema.safeParse('KRAKEN').success).toBe(true);
      expect(PlatformSchema.safeParse('Alpaca').success).toBe(true);
    });

    it('rejects invalid platforms', () => {
      expect(PlatformSchema.safeParse('').success).toBe(false);
      expect(PlatformSchema.safeParse(123).success).toBe(false);
    });
  });

  describe('AssetClassSchema', () => {
    it('accepts all valid asset classes', () => {
      for (const cls of ['EQUITY', 'CRYPTO', 'BOND', 'COMMODITY', 'CURRENCY', 'OTHER']) {
        expect(AssetClassSchema.parse(cls)).toBe(cls);
      }
    });

    it('rejects invalid asset classes', () => {
      expect(AssetClassSchema.safeParse('STOCK').success).toBe(false);
      expect(AssetClassSchema.safeParse('').success).toBe(false);
    });
  });

  describe('ExtractedPositionSchema', () => {
    it('accepts a minimal position (symbol only)', () => {
      const result = ExtractedPositionSchema.safeParse({ symbol: 'BTC' });
      expect(result.success).toBe(true);
    });

    it('accepts a fully populated position', () => {
      const result = ExtractedPositionSchema.safeParse({
        symbol: 'AAPL',
        name: 'Apple Inc.',
        quantity: 10,
        costBasis: 150,
        currentPrice: 175,
        marketValue: 1750,
        unrealizedPnl: 250,
        unrealizedPnlPercent: 16.67,
        assetClass: 'EQUITY',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty symbol', () => {
      const result = ExtractedPositionSchema.safeParse({ symbol: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing symbol', () => {
      const result = ExtractedPositionSchema.safeParse({ name: 'Bitcoin', quantity: 1 });
      expect(result.success).toBe(false);
    });

    it('rejects non-number quantity', () => {
      const result = ExtractedPositionSchema.safeParse({ symbol: 'BTC', quantity: '1.5' });
      expect(result.success).toBe(false);
    });

    it('accepts zero values', () => {
      const result = ExtractedPositionSchema.safeParse({
        symbol: 'DOGE',
        quantity: 0,
        currentPrice: 0,
        marketValue: 0,
      });
      expect(result.success).toBe(true);
    });

    it('accepts negative P&L values', () => {
      const result = ExtractedPositionSchema.safeParse({
        symbol: 'META',
        unrealizedPnl: -500,
        unrealizedPnlPercent: -12.5,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('ExtractionResponseSchema', () => {
    it('accepts valid response with positions', () => {
      const result = ExtractionResponseSchema.safeParse({
        platform: 'COINBASE',
        positions: [{ symbol: 'BTC' }],
      });
      expect(result.success).toBe(true);
    });

    it('accepts empty positions array (empty portfolio)', () => {
      const result = ExtractionResponseSchema.safeParse({
        platform: 'COINBASE',
        positions: [],
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing platform', () => {
      const result = ExtractionResponseSchema.safeParse({
        positions: [{ symbol: 'BTC' }],
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing positions', () => {
      const result = ExtractionResponseSchema.safeParse({
        platform: 'COINBASE',
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional notes field', () => {
      const result = ExtractionResponseSchema.safeParse({
        platform: 'ROBINHOOD',
        positions: [{ symbol: 'TSLA' }],
        notes: 'Partial screenshot — some positions may be cut off',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notes).toBe('Partial screenshot — some positions may be cut off');
      }
    });

    it('strips unknown fields', () => {
      const result = ExtractionResponseSchema.safeParse({
        platform: 'MANUAL',
        positions: [{ symbol: 'XYZ', unknownField: true }],
        extraField: 'ignored',
      });
      expect(result.success).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// extractJsonFromResponse — additional edge cases
// ---------------------------------------------------------------------------

describe('extractJsonFromResponse — edge cases', () => {
  it('returns null for empty string', () => {
    expect(extractJsonFromResponse('')).toBeNull();
  });

  it('returns null for whitespace-only input', () => {
    expect(extractJsonFromResponse('   \n\t  ')).toBeNull();
  });

  it('handles JSON with leading whitespace', () => {
    const result = extractJsonFromResponse('  \n  {"platform":"COINBASE","positions":[]}');
    expect(result).toEqual({ platform: 'COINBASE', positions: [] });
  });

  it('handles JSON with trailing text after closing brace', () => {
    const result = extractJsonFromResponse('{"platform":"MANUAL","positions":[{"symbol":"A"}]} some trailing text');
    expect(result).toEqual({ platform: 'MANUAL', positions: [{ symbol: 'A' }] });
  });

  it('handles nested JSON objects', () => {
    const nested = {
      platform: 'COINBASE',
      positions: [{ symbol: 'BTC', name: 'Bitcoin' }],
      notes: 'Contains {curly} braces',
    };
    const result = extractJsonFromResponse(JSON.stringify(nested));
    expect(result).toEqual(nested);
  });

  it('handles multiple code fences — takes first', () => {
    const text =
      '```json\n{"platform":"COINBASE","positions":[]}\n```\n\nAnother block:\n```json\n{"other": true}\n```';
    const result = extractJsonFromResponse(text);
    expect(result).toEqual({ platform: 'COINBASE', positions: [] });
  });

  it('handles JSON with unicode characters', () => {
    const result = extractJsonFromResponse(
      '{"platform":"MANUAL","positions":[{"symbol":"BTC","name":"ビットコイン"}]}',
    );
    expect(result).toEqual({ platform: 'MANUAL', positions: [{ symbol: 'BTC', name: 'ビットコイン' }] });
  });
});

// ---------------------------------------------------------------------------
// computeConfidence — additional edge cases
// ---------------------------------------------------------------------------

describe('computeConfidence — edge cases', () => {
  it('handles position with only symbol (0 optional fields)', () => {
    const { perPosition } = computeConfidence([{ symbol: 'XRP' }]);
    expect(perPosition[0].fieldsExtracted).toBe(0);
    expect(perPosition[0].confidence).toBe(0.3); // 0 completeness + 1 consistency (can't check)
  });

  it('handles marketValue of 0 with quantity 0', () => {
    const { perPosition } = computeConfidence([{ symbol: 'SOLD', quantity: 0, currentPrice: 100, marketValue: 0 }]);
    expect(perPosition[0].consistencyCheck).toBe(true);
  });

  it('handles marketValue of 0 with non-zero quantity', () => {
    const { perPosition } = computeConfidence([{ symbol: 'BUG', quantity: 10, currentPrice: 100, marketValue: 0 }]);
    expect(perPosition[0].consistencyCheck).toBe(false);
  });

  it('fails consistency at exactly the tolerance boundary', () => {
    // 5% tolerance: 100 * 1.06 = 106 > 5% over
    const { perPosition } = computeConfidence([{ symbol: 'EDGE', quantity: 1, currentPrice: 100, marketValue: 106 }]);
    expect(perPosition[0].consistencyCheck).toBe(false);
  });

  it('passes consistency at exactly the tolerance boundary', () => {
    // 5% tolerance: 100 * 1.05 = 105 exactly at boundary
    const { perPosition } = computeConfidence([{ symbol: 'EDGE', quantity: 1, currentPrice: 100, marketValue: 105 }]);
    expect(perPosition[0].consistencyCheck).toBe(true);
  });

  it('handles very small fractional quantities (crypto)', () => {
    const { perPosition } = computeConfidence([
      { symbol: 'BTC', quantity: 0.00001, currentPrice: 67000, marketValue: 0.67 },
    ]);
    expect(perPosition[0].consistencyCheck).toBe(true);
  });

  it('handles large portfolios with many positions', () => {
    const positions: ExtractedPosition[] = Array.from({ length: 50 }, (_, i) => ({
      symbol: `SYM${i}`,
      name: `Stock ${i}`,
      quantity: 10,
      currentPrice: 100,
      marketValue: 1000,
    }));
    const { overall, perPosition } = computeConfidence(positions);
    expect(perPosition).toHaveLength(50);
    expect(overall).toBeGreaterThan(0);
    expect(overall).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// buildExtractionPrompt — additional cases
// ---------------------------------------------------------------------------

describe('buildExtractionPrompt — edge cases', () => {
  it('replaces underscores in platform hint with spaces', () => {
    const prompt = buildExtractionPrompt('INTERACTIVE_BROKERS');
    // The platform hint line uses spaces, the JSON example retains underscores
    expect(prompt).toContain('INTERACTIVE BROKERS');
    expect(prompt).toContain('user indicated');
  });

  it('includes JSON structure example in prompt', () => {
    const prompt = buildExtractionPrompt();
    expect(prompt).toContain('"symbol"');
    expect(prompt).toContain('"positions"');
    expect(prompt).toContain('"assetClass"');
  });

  it('includes extraction rules', () => {
    const prompt = buildExtractionPrompt();
    expect(prompt).toContain('Extract ONLY');
    expect(prompt).toContain('no currency symbols');
  });
});

// ---------------------------------------------------------------------------
// parsePortfolioScreenshot — additional edge cases
// ---------------------------------------------------------------------------

describe('parsePortfolioScreenshot — edge cases', () => {
  it('handles provider returning multiple text blocks', async () => {
    const provider: AgentLoopProvider = {
      completeWithTools: vi.fn(async () => ({
        content: [
          { type: 'text' as const, text: '```json\n' },
          { type: 'text' as const, text: VALID_RESPONSE },
          { type: 'text' as const, text: '\n```' },
        ],
        stopReason: 'end_turn',
        usage: { inputTokens: 800, outputTokens: 400 },
      })),
    };

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.positions).toHaveLength(2);
  });

  it('handles provider returning no usage info', async () => {
    const provider: AgentLoopProvider = {
      completeWithTools: vi.fn(async () => ({
        content: [{ type: 'text' as const, text: VALID_RESPONSE }],
        stopReason: 'end_turn',
      })),
    };

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.metadata.usage).toBeUndefined();
  });

  it('handles response with only tool_use blocks (no text)', async () => {
    const provider: AgentLoopProvider = {
      completeWithTools: vi.fn(async () => ({
        content: [{ type: 'tool_use' as const, id: 'tc1', name: 'some_tool', input: {} }],
        stopReason: 'tool_use',
        usage: { inputTokens: 100, outputTokens: 50 },
      })),
    };

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('empty response');
  });

  it('handles non-Error thrown from provider', async () => {
    const provider: AgentLoopProvider = {
      completeWithTools: vi.fn(async () => {
        throw 'string error';
      }),
    };

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('Vision API call failed');
    expect(result.error).toContain('string error');
  });

  it('includes consistency warnings in metadata', async () => {
    const response = JSON.stringify({
      platform: 'INTERACTIVE_BROKERS',
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple',
          quantity: 10,
          costBasis: 150,
          currentPrice: 175,
          marketValue: 5000, // Inconsistent: should be 1750
          unrealizedPnl: 250,
          unrealizedPnlPercent: 16.67,
        },
      ],
    });
    const provider = mockProvider(response);

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.metadata.warnings.some((w) => w.includes('Inconsistent values for AAPL'))).toBe(true);
    expect(result.metadata.positionConfidences[0].consistencyCheck).toBe(false);
  });

  it('handles all supported media types', async () => {
    for (const mediaType of ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const) {
      const provider = mockProvider(VALID_RESPONSE);

      const result = await parsePortfolioScreenshot({
        imageData: DUMMY_IMAGE,
        mediaType,
        provider,
        model: 'claude-sonnet-4-6',
      });

      expect(result.success).toBe(true);

      const call = vi.mocked(provider.completeWithTools).mock.calls[0][0];
      const blocks = call.messages[0].content as Array<{ type: string; source?: { media_type: string } }>;
      const imageBlock = blocks.find((b) => b.type === 'image');
      expect(imageBlock?.source?.media_type).toBe(mediaType);
    }
  });

  it('sets correct extractedAt timestamp', async () => {
    const provider = mockProvider(VALID_RESPONSE);
    const before = new Date().toISOString();

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    const after = new Date().toISOString();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.metadata.extractedAt >= before).toBe(true);
    expect(result.metadata.extractedAt <= after).toBe(true);
  });

  it('passes system prompt to provider', async () => {
    const provider = mockProvider(VALID_RESPONSE);

    await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    const call = vi.mocked(provider.completeWithTools).mock.calls[0][0];
    expect(call.system).toBeDefined();
    expect(call.system).toContain('financial data extraction');
  });

  it('sends no tools to provider (pure vision call)', async () => {
    const provider = mockProvider(VALID_RESPONSE);

    await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    const call = vi.mocked(provider.completeWithTools).mock.calls[0][0];
    expect(call.tools).toBeUndefined();
  });

  it('handles positions with all valid asset classes', async () => {
    const response = JSON.stringify({
      platform: 'MANUAL',
      positions: [
        { symbol: 'AAPL', assetClass: 'EQUITY' },
        { symbol: 'BTC', assetClass: 'CRYPTO' },
        { symbol: 'TLT', assetClass: 'BOND' },
        { symbol: 'GLD', assetClass: 'COMMODITY' },
        { symbol: 'EURUSD', assetClass: 'CURRENCY' },
        { symbol: 'MISC', assetClass: 'OTHER' },
      ],
    });
    const provider = mockProvider(response);

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.positions).toHaveLength(6);
    expect(result.positions.map((p) => p.assetClass)).toEqual([
      'EQUITY',
      'CRYPTO',
      'BOND',
      'COMMODITY',
      'CURRENCY',
      'OTHER',
    ]);
  });

  it('rejects response with invalid asset class', async () => {
    const response = JSON.stringify({
      platform: 'COINBASE',
      positions: [{ symbol: 'BTC', assetClass: 'INVALID' }],
    });
    const provider = mockProvider(response);

    const result = await parsePortfolioScreenshot({
      imageData: DUMMY_IMAGE,
      mediaType: 'image/png',
      provider,
      model: 'claude-sonnet-4-6',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('Validation failed');
  });
});
