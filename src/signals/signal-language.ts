/**
 * Signal Language Standards — deterministic validators for signal copy quality.
 *
 * Enforces two rules from YOJ-162:
 *   1. No emotionally charged language (banned words)
 *   2. No tautological conclusions (restating what the price move already shows)
 *
 * The banned word list is a named constant so it can be extended without
 * touching prompt logic, and tested deterministically.
 */

// ---------------------------------------------------------------------------
// Rule 1 — Banned words / phrases (emotionally charged language)
// ---------------------------------------------------------------------------

/**
 * Words and phrases that editorialize price moves instead of describing them factually.
 * Applied case-insensitively. Entries may be multi-word phrases.
 */
export const BANNED_SIGNAL_WORDS: readonly string[] = [
  'sharply',
  'plunged',
  'surged',
  'soared',
  'tumbled',
  'spiked',
  'cratered',
  'tanked',
  'rocketed',
  'skyrocketed',
  'fell',
  'rallied',
  'strong bearish momentum',
  'strong bullish momentum',
  'significant decline',
  'significant rally',
  'major move',
  'massive drop',
  'massive gain',
  'dramatic',
  'alarming',
  'impressive',
  'remarkable',
] as const;

// Pre-compiled regex — compiled once at module load so matching runs in a single pass.
// Word boundaries around the group prevent "fell" from matching "fellow".
const BANNED_RE = new RegExp(
  `\\b(?:${BANNED_SIGNAL_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i',
);

/**
 * Check whether text contains any banned emotionally charged language.
 * Returns the first matched word/phrase, or `null` if clean.
 */
export function containsBannedLanguage(text: string): string | null {
  const match = BANNED_RE.exec(text);
  return match ? match[0] : null;
}

// ---------------------------------------------------------------------------
// Rule 2 — Tautological conclusions (obvious restatements of price moves)
// ---------------------------------------------------------------------------

/**
 * Patterns that restate what a price move already communicates.
 * e.g. "X dropped 5%, suggesting selling pressure" — the drop IS the selling pressure.
 *
 * Each pattern matches a price-move verb/context followed by a filler conclusion.
 */
const TAUTOLOGICAL_PATTERNS: readonly RegExp[] = [
  // "down/dropped/declined X% ... suggesting/indicating selling pressure"
  /(?:down|dropped|declined|lost|decrease)\b.*?\b(?:suggest(?:s|ing)?|indicat(?:e|es|ing)|signal(?:s|ling)?|point(?:s|ing)? to|impl(?:y|ies|ying))\s+(?:selling pressure|bearish (?:momentum|sentiment|trend)|further (?:decline|downside|weakness)|negative (?:momentum|sentiment))/i,
  // "up/gained/rose X% ... suggesting/indicating buying interest"
  /(?:up|gained|rose|increased|advance)\b.*?\b(?:suggest(?:s|ing)?|indicat(?:e|es|ing)|signal(?:s|ling)?|point(?:s|ing)? to|impl(?:y|ies|ying))\s+(?:buying (?:interest|pressure)|bullish (?:momentum|sentiment|trend)|further (?:upside|gains|strength)|positive (?:momentum|sentiment))/i,
  // "bearish/bullish momentum" followed by an obvious restatement conclusion
  /\b(?:bearish|bullish)\s+momentum\b.*?\b(?:suggest(?:s|ing)?|indicat(?:e|es|ing)|signal(?:s|ling)?|confirm(?:s|ing)?|point(?:s|ing)? to|impl(?:y|ies|ying))\s+(?:selling pressure|buying (?:interest|pressure)|further (?:decline|downside|upside|gains|weakness|strength)|negative (?:momentum|sentiment)|positive (?:momentum|sentiment))/i,
] as const;

/**
 * Check whether tier2 copy is a tautological restatement of a price move.
 * Returns `true` if the text restates the obvious without adding new information.
 */
export function isTautologicalTier2(text: string): boolean {
  return TAUTOLOGICAL_PATTERNS.some((rx) => rx.test(text));
}
