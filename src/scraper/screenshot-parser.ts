/**
 * Screenshot portfolio parser — sends a portfolio screenshot to Claude Vision
 * and extracts structured position data with confidence scoring.
 */

import {
  type ExtractedPosition,
  type ExtractionMetadata,
  ExtractionResponseSchema,
  type ParseScreenshotParams,
  type PositionConfidence,
  type ScreenshotParseResult,
} from './types.js';
import type { Platform } from '../api/graphql/types.js';
import type { AgentMessage } from '../core/types.js';
import { createSubsystemLogger } from '../logging/logger.js';

export type { ParseScreenshotParams } from './types.js';

const logger = createSubsystemLogger('screenshot-parser');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parsePortfolioScreenshot(params: ParseScreenshotParams): Promise<ScreenshotParseResult> {
  const { imageData, mediaType, provider, model, platformHint, maxTokens = 4096 } = params;

  const base64Data = imageData.toString('base64');
  const prompt = buildExtractionPrompt(platformHint);

  const messages: AgentMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Data },
        },
        { type: 'text', text: prompt },
      ],
    },
  ];

  let responseText: string;
  let usage: { inputTokens: number; outputTokens: number } | undefined;

  try {
    const result = await provider.completeWithTools({
      model,
      system: SYSTEM_PROMPT,
      messages,
      maxTokens,
    });

    usage = result.usage;
    const textBlocks = result.content.filter((b) => b.type === 'text');
    responseText = textBlocks.map((b) => ('text' in b ? b.text : '')).join('');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Vision API call failed', { error: msg });
    return { success: false, error: `Vision API call failed: ${msg}` };
  }

  if (!responseText.trim()) {
    return { success: false, error: 'Vision API returned empty response' };
  }

  // Extract and validate JSON
  const json = extractJsonFromResponse(responseText);
  if (json === null) {
    logger.warn('Could not extract JSON from response', { responseText: responseText.slice(0, 500) });
    return { success: false, error: 'Could not extract JSON from vision response' };
  }

  const parsed = ExtractionResponseSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn('Zod validation failed', { errors: parsed.error.issues });
    return { success: false, error: `Validation failed: ${parsed.error.issues.map((i) => i.message).join(', ')}` };
  }

  const { platform, positions, notes } = parsed.data;
  const { overall, perPosition } = computeConfidence(positions);

  const warnings: string[] = [];
  if (notes) warnings.push(notes);

  for (const pc of perPosition) {
    if (!pc.consistencyCheck) {
      warnings.push(`Inconsistent values for ${pc.symbol} — quantity * price does not match market value`);
    }
    if (pc.fieldsExtracted < 4) {
      warnings.push(
        `Incomplete data for ${pc.symbol} — only ${pc.fieldsExtracted} of ${pc.fieldsExpected} fields extracted`,
      );
    }
  }

  const metadata: ExtractionMetadata = {
    source: 'SCREENSHOT',
    platform,
    extractedAt: new Date().toISOString(),
    confidence: overall,
    positionConfidences: perPosition,
    warnings,
    usage,
  };

  logger.info('Screenshot parsed successfully', {
    platform,
    positionCount: positions.length,
    confidence: overall.toFixed(2),
  });

  return { success: true, positions, metadata };
}

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'You are a financial data extraction assistant. You analyze screenshots of investment portfolio ' +
  'platforms and extract position data into structured JSON. Be precise — only extract data you can ' +
  'clearly read. Omit fields you cannot determine. Never guess values.';

export function buildExtractionPrompt(platformHint?: Platform): string {
  const platformLine = platformHint
    ? `The user indicated this is from ${platformHint.replace(/_/g, ' ')}. Use this as context but verify from the screenshot.`
    : 'Identify the platform from the UI (Coinbase, Robinhood, Interactive Brokers, or MANUAL if unrecognizable).';

  return `Analyze this portfolio screenshot and extract all visible positions.

${platformLine}

Return a JSON object with this exact structure:
{
  "platform": "COINBASE" | "ROBINHOOD" | "INTERACTIVE_BROKERS" | "MANUAL",
  "positions": [
    {
      "symbol": "BTC",
      "name": "Bitcoin",
      "quantity": 0.5,
      "costBasis": 29000,
      "currentPrice": 67234,
      "marketValue": 33617,
      "unrealizedPnl": 4617,
      "unrealizedPnlPercent": 15.9,
      "assetClass": "CRYPTO"
    }
  ],
  "notes": "Optional notes about extraction issues"
}

Rules:
- Extract ONLY values you can clearly read from the screenshot
- Omit any field you cannot determine (do not guess)
- Use the symbol/ticker exactly as shown
- All monetary values should be numbers (no currency symbols or commas)
- assetClass: EQUITY for stocks/ETFs, CRYPTO for crypto, BOND, COMMODITY, CURRENCY, or OTHER
- If a position is partially visible, include what you can read and omit the rest
- Include a "notes" field if anything was unclear or partially readable

Return ONLY the JSON object, no other text.`;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

export function extractJsonFromResponse(text: string): unknown {
  // Try raw JSON first
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to regex extraction
    }
  }

  // Try markdown-fenced JSON
  const fenceMatch = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/.exec(text);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Fall through
    }
  }

  // Last resort: try to find a JSON object anywhere in the text.
  // NOTE: this regex is greedy — it matches from the first '{' to the last '}',
  // which can fail if there are stray '}' characters after the JSON payload.
  // If the LLM returns well-formed JSON as instructed, this is rarely hit.
  const objectMatch = /\{[\s\S]*\}/.exec(text);
  if (objectMatch?.[0]) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // Give up
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

const EXPECTED_FIELDS = [
  'name',
  'quantity',
  'costBasis',
  'currentPrice',
  'marketValue',
  'unrealizedPnl',
  'unrealizedPnlPercent',
  'assetClass',
] as const;
const COMPLETENESS_WEIGHT = 0.7;
const CONSISTENCY_WEIGHT = 0.3;
const CONSISTENCY_TOLERANCE = 0.05;

export function computeConfidence(positions: ExtractedPosition[]): {
  overall: number;
  perPosition: PositionConfidence[];
} {
  const perPosition: PositionConfidence[] = positions.map((pos) => {
    const fieldsExtracted = EXPECTED_FIELDS.filter((f) => pos[f] != null).length;
    const completeness = fieldsExtracted / EXPECTED_FIELDS.length;

    const consistencyCheck = checkConsistency(pos);

    const consistencyScore = consistencyCheck ? 1 : 0;
    const confidence = completeness * COMPLETENESS_WEIGHT + consistencyScore * CONSISTENCY_WEIGHT;

    return {
      symbol: pos.symbol,
      confidence: Math.round(confidence * 100) / 100,
      fieldsExtracted,
      fieldsExpected: EXPECTED_FIELDS.length,
      consistencyCheck,
    };
  });

  const overall =
    perPosition.length > 0
      ? Math.round((perPosition.reduce((sum, p) => sum + p.confidence, 0) / perPosition.length) * 100) / 100
      : 0;

  return { overall, perPosition };
}

function checkConsistency(pos: ExtractedPosition): boolean {
  if (pos.quantity == null || pos.currentPrice == null || pos.marketValue == null) {
    // Can't check — assume consistent (don't penalize incomplete data)
    return true;
  }

  if (pos.marketValue === 0) return pos.quantity === 0 || pos.currentPrice === 0;

  const computed = pos.quantity * pos.currentPrice;
  const diff = Math.abs(computed - pos.marketValue) / Math.abs(pos.marketValue);
  return diff <= CONSISTENCY_TOLERANCE;
}
