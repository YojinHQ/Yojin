import type { PositionInsight, InsightRating } from '../api/types';

const RATING_LABEL: Record<InsightRating, string> = {
  VERY_BULLISH: 'Very Bullish',
  BULLISH: 'Bullish',
  NEUTRAL: 'Neutral',
  BEARISH: 'Bearish',
  VERY_BEARISH: 'Very Bearish',
};

const X_MAX_CHARS = 280;
export const YOJIN_SITE_URL = 'https://yojin.ai/';
const SHORT_SITE = 'yojin.ai';

export interface ShareSnippet {
  /** Full text body for WhatsApp — thesis + bull/bear case + attribution. */
  long: string;
  /** Short form capped at 280 chars, used when an X-style limit applies. */
  short: string;
  /**
   * Minimal caption for use when an image of the card is attached. The image
   * already carries the thesis and bull/bear bullets, so duplicating them in
   * text is noise — this is just a one-line hook + attribution.
   */
  caption: string;
}

/**
 * Build shareable text from a PositionInsight. Portfolio-tied fields
 * (memoryContext, priceTarget, allSignalIds, keySignals, carriedForward) are
 * intentionally excluded — the snippet must not reveal the user's holdings,
 * private reasoning history, or target prices.
 */
export function buildInsightSnippet(insight: PositionInsight): ShareSnippet {
  const rating = RATING_LABEL[insight.rating];
  const header = `$${insight.symbol} · ${rating}`;
  const thesis = insight.thesis.trim();
  const thesisQuote = `"${thesis.replace(/"/g, "'")}"`;

  const bulls = insight.opportunities.slice(0, 2);
  const bears = insight.risks.slice(0, 2);

  const longParts: string[] = [thesisQuote];
  if (bulls.length > 0) {
    longParts.push('', 'Bull case', ...bulls.map((o) => `• ${o}`));
  }
  if (bears.length > 0) {
    longParts.push('', 'Bear case', ...bears.map((r) => `• ${r}`));
  }
  longParts.push('', SHORT_SITE);

  return {
    long: longParts.join('\n'),
    short: buildShortSnippet(header, thesis),
    caption: `${header}\n— Yojin · ${SHORT_SITE}`,
  };
}

function buildShortSnippet(header: string, thesis: string): string {
  const tail = `\n\n— Yojin · ${SHORT_SITE}`;
  const available = X_MAX_CHARS - header.length - tail.length - 2; // 2 for "\n\n"
  const body = thesis.length > available ? `${thesis.slice(0, Math.max(0, available - 1)).trimEnd()}…` : thesis;
  return `${header}\n\n${body}${tail}`;
}

function sentimentToRating(sentiment?: string | null): InsightRating {
  if (sentiment === 'bullish' || sentiment === 'BULLISH') return 'BULLISH';
  if (sentiment === 'bearish' || sentiment === 'BEARISH') return 'BEARISH';
  return 'NEUTRAL';
}

// Internal ticker sentinels used elsewhere in the UI for items without a
// concrete symbol. Sharing would render them as `$MACRO · Neutral` which is
// misleading — gate the Share menu off entirely when we see one.
const TICKER_SENTINELS = new Set(['MACRO', 'UNKNOWN', 'N/A']);

/**
 * Build a minimal PositionInsight from a feed item's surface fields.
 * Used when the Share button appears on intel feed cards where the full
 * research report isn't in scope. Returns null when no ticker is available
 * or the ticker is a sentinel placeholder.
 */
export function buildShareableFromFeed(params: {
  symbol: string | null | undefined;
  title: string;
  sentiment?: string | null;
  confidence?: number | null;
  opportunities?: string[];
}): PositionInsight | null {
  if (!params.symbol) return null;
  if (TICKER_SENTINELS.has(params.symbol.toUpperCase())) return null;
  const conviction =
    params.confidence != null
      ? Math.max(0, Math.min(1, params.confidence > 1 ? params.confidence / 100 : params.confidence))
      : 0.5;
  return {
    symbol: params.symbol,
    name: params.symbol,
    rating: sentimentToRating(params.sentiment),
    conviction,
    thesis: params.title,
    keySignals: [],
    allSignalIds: [],
    risks: [],
    opportunities: (params.opportunities ?? []).slice(0, 2),
    memoryContext: null,
    priceTarget: null,
  };
}

export function buildTelegramUrl(text: string, imageUrl?: string): string {
  const params = new URLSearchParams({ text });
  params.set('url', imageUrl ?? YOJIN_SITE_URL);
  return `https://t.me/share/url?${params.toString()}`;
}

export function buildWhatsAppUrl(text: string, imageUrl?: string): string {
  const body = imageUrl ? `${text}\n\n${imageUrl}` : text;
  return `https://wa.me/?text=${encodeURIComponent(body)}`;
}

export function buildXUrl(text: string, imageUrl?: string): string {
  const params = new URLSearchParams({ text });
  if (imageUrl) params.set('url', imageUrl);
  return `https://x.com/intent/tweet?${params.toString()}`;
}
