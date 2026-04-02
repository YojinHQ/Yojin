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
 */
export const JUNK_TITLE_RE =
  /__\w+__|stock quote price|stock quotes? from|stock price|in real time$|tradingview|quote & history|price and forecast|price chart|commission-free|buy and sell|closed at \$|what you need to know$|spy vs\.? spy|song and lyrics|official music video|official video|official audio|full album|definition and meaning|definition of\b|meaning of\b|\bdefinition\b.*\bdictionary\b/i;

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
