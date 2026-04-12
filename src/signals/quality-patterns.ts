/**
 * Shared quality-filter patterns for the signal pipeline.
 *
 * Used by:
 *   - SignalIngestor (pre-filter before LLM evaluation)
 *   - QualityAgent (deterministic false-match safety net)
 *   - Curation pipeline (safety-net filters for signals that bypassed LLM enrichment)
 *   - Jintel signal-fetcher (skip junk at data-source level)
 */

// ---------------------------------------------------------------------------
// Domain patterns — non-financial sites that frequently match short tickers
// ---------------------------------------------------------------------------

/**
 * Non-financial domains that frequently match short tickers as substrings.
 * Superset of patterns previously split across ingestor.ts and signal-fetcher.ts —
 * imdb.com, rottentomatoes.com, fandom.com were ingestor-only; now applied uniformly.
 */
export const JUNK_DOMAIN_RE =
  /\b(spotify\.com|soundcloud\.com|genius\.com|bandcamp\.com|deezer\.com|tidal\.com|shazam\.com|collinsdictionary\.com|merriam-webster\.com|dictionary\.com|wiktionary\.org|wikipedia\.org|urbandictionary\.com|cambridge\.org\/dictionary|oxforddictionaries\.com|imdb\.com|rottentomatoes\.com|fandom\.com)\b/i;

// ---------------------------------------------------------------------------
// Title patterns — non-financial content or scraper boilerplate
// ---------------------------------------------------------------------------

/**
 * Title patterns that indicate non-financial content or scraper junk.
 * Superset of patterns previously split across ingestor.ts and signal-fetcher.ts —
 * `stock price`, `closed at $`, `what you need to know`, `spy vs spy` were
 * signal-fetcher-only; now applied uniformly at all pipeline stages.
 *
 * Price-chatter patterns catch articles that restate the current price with a vague
 * "amid" clause and no named catalyst — e.g. "BTC at $68K amid geopolitical developments",
 * "Bitcoin crosses $69K amid altcoin gains", "BTC near $67,969, up 0.32% intraday".
 */
export const JUNK_TITLE_RE =
  /__\w+__|stock quote price|stock quotes? from|stock price|in real time$|tradingview|quote & history|price and forecast|price chart|commission-free|buy and sell|closed at \$|what you need to know$|spy vs\.? spy|song and lyrics|official music video|official video|official audio|full album|definition and meaning|definition of\b|meaning of\b|\bdefinition\b.*\bdictionary\b|\b(?:at|near|crosses?|hits?|reaches?)\s+\$[\d,K.]+|\bup\s+\d+\.?\d*%\s+intraday|\bprices?\s+(?:up|down)\s+on\b|price today.+live price|live price.+(?:chart|marketcap)|price.+chart\s*&\s*price history|\bto\s+USD\s+live\s+price\b|^\s*[\d,.]+\s*\|\s*[A-Z]{2,6}\s+[A-Z]{2,6}\s*\||\b[A-Z]{2,6}\s+to\s+[A-Z]{2,6}\s*[-–]\s*(?:binance|coinbase|kraken|bybit|okx|kucoin|huobi|bitfinex|gemini|bitstamp)/i;

// ---------------------------------------------------------------------------
// Content patterns — body-level junk detection
// ---------------------------------------------------------------------------

/** Content patterns indicating junk — tracking pixels, ad images, empty scrapes. */
export const JUNK_CONTENT_RE =
  /(?:tracking pixel|ad[- ]?related image|no substantive (?:financial |market )?(?:news|content|signal|data)|only (?:contains?|includes?) (?:tracking|ad|pixel|image)|no (?:usable|actionable|meaningful) (?:data|information|content|signal)|(?:lacks|lacking) substance|content is inaccessible|website boilerplate|navigation elements with no actual)/i;

// ---------------------------------------------------------------------------
// False-match detection — catches LLM text that describes a false match
// ---------------------------------------------------------------------------

/**
 * Deterministic false-match safety net — catches cases where the LLM describes
 * a false match in its text but returns verdict=KEEP / isFalseMatch=false.
 *
 * Applied at multiple pipeline stages:
 *   - QualityAgent: overrides verdict to DROP when tier1/tier2 admit false match
 *   - Curation pipeline: catches signals from external sources with pre-set tier1/tier2
 */
export const FALSE_MATCH_TEXT_RE =
  /\bnot (?:related to|about|referring to)\b|\bno relevance to\b|\bnot .{1,40}(?:stock|ticker|corporation|company)\b|\bis about .{1,60}, not\b/i;

/**
 * Deterministic self-invalidating safety net — catches cases where the LLM's own
 * summary admits the signal is unverifiable, anecdotal, or speculative but still
 * returns verdict=KEEP. Applied in QualityAgent.parseResponse() to override verdict
 * to DROP with dropReason=low_quality.
 *
 * Patterns are narrowed to avoid false-positives on legitimate denial/refutation
 * news (e.g. "Tesla denied an unverified claim", "management found no evidence of
 * a breach"). "unverified claim" uses a negative lookbehind for denial verbs;
 * "no evidence" requires a follow-up indicating the signal's own support is weak.
 * Dead-post markers ([removed], [deleted], post/source unavailable) are included
 * to catch social signals whose backing content has been taken down.
 */
export const SELF_INVALIDATING_RE =
  /\blacks (?:independent )?verification\b|(?<!(?:denied|refuted|dismissed|rejected) (?:an? )?)\bunverified claim\b|\bremains? speculative\b|\brel(?:y|ies) on anecdotal\b|\bno (?:independent )?confirmation from (?:the )?(?:company|management)\b|\bcannot be (?:verified|substantiated|corroborated)\b|\bself[- ]reported (?:and )?unverified\b|\bno (?:supporting )?evidence (?:to (?:support|back|substantiate)|beyond|for (?:the |this ))\b|\bbased on (?:a single|one) (?:user'?s?|person'?s?) (?:observation|claim|report)\b|\[(?:removed|deleted)\]|\b(?:post|source) (?:(?:is|has been|was) )?(?:unavailable|removed|deleted)\b/i;

/**
 * Broader false-match pattern including explicit "false match" / "false positive" labels.
 * Used by the curation pipeline where signals may arrive from external sources
 * with tier1/tier2 explicitly calling out false matches.
 */
export const FALSE_MATCH_LABEL_RE =
  /\b(?:false[- ]match|false[- ]positive)\b|\bno (?:relevance|relation) to\b|\bnot .{1,40}(?:stock|ticker|corporation|company)\b/i;

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Minimum title length for a meaningful signal. */
export const MIN_TITLE_LENGTH = 10;

/** Maximum age (in ms) for a signal to be worth processing (90 days). */
export const MAX_SIGNAL_AGE_MS = 90 * 24 * 60 * 60 * 1000;
