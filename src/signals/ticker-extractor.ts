/**
 * Ticker extraction from news text.
 *
 * Phase 1: regex-based extraction for common patterns ($AAPL, NASDAQ:AAPL).
 * Phase 2: pluggable SymbolIndex integration (from YOJ-50) for fuzzy company
 * name → ticker resolution.
 */

// Common English words that happen to match 2-4 letter tickers
const FALSE_POSITIVES = new Set([
  'A',
  'I',
  'AM',
  'AN',
  'AS',
  'AT',
  'BE',
  'BY',
  'DO',
  'GO',
  'HE',
  'IF',
  'IN',
  'IS',
  'IT',
  'ME',
  'MY',
  'NO',
  'OF',
  'OK',
  'ON',
  'OR',
  'SO',
  'TO',
  'UP',
  'US',
  'WE',
  'ALL',
  'AND',
  'ARE',
  'BIG',
  'BUT',
  'CAN',
  'CEO',
  'CFO',
  'COO',
  'CTO',
  'DID',
  'ETF',
  'FOR',
  'GDP',
  'GET',
  'GOT',
  'HAS',
  'HAD',
  'HER',
  'HIM',
  'HIS',
  'HOW',
  'IPO',
  'ITS',
  'LET',
  'MAY',
  'NEW',
  'NOT',
  'NOW',
  'OLD',
  'ONE',
  'OUR',
  'OUT',
  'OWN',
  'PUT',
  'RAN',
  'RUN',
  'SAY',
  'SEC',
  'SET',
  'SHE',
  'THE',
  'TOO',
  'TOP',
  'TRY',
  'TWO',
  'USE',
  'VIA',
  'WAS',
  'WAY',
  'WHO',
  'WHY',
  'WIN',
  'WON',
  'YET',
  'YOU',
  'ALSO',
  'BEEN',
  'BEST',
  'BOTH',
  'CALL',
  'CAME',
  'CASH',
  'COME',
  'CORE',
  'DEAL',
  'EACH',
  'EVEN',
  'FACE',
  'FACT',
  'FALL',
  'FEEL',
  'FIND',
  'FIVE',
  'FOUR',
  'FREE',
  'FROM',
  'FULL',
  'FUND',
  'GAVE',
  'GOOD',
  'GROW',
  'HALF',
  'HAVE',
  'HEAD',
  'HELP',
  'HERE',
  'HIGH',
  'HOLD',
  'HOME',
  'HOPE',
  'INTO',
  'JUST',
  'KEEP',
  'KNOW',
  'LAST',
  'LATE',
  'LEAD',
  'LEFT',
  'LESS',
  'LIKE',
  'LINE',
  'LIVE',
  'LONG',
  'LOOK',
  'LOSE',
  'LOST',
  'MADE',
  'MAIN',
  'MAKE',
  'MANY',
  'MARK',
  'MEAN',
  'MIND',
  'MORE',
  'MOST',
  'MOVE',
  'MUCH',
  'MUST',
  // 'NEAR' removed — legitimate crypto ticker via NAME_TO_TICKER ('near protocol')
  'NEED',
  'NEXT',
  'NINE',
  'NOTE',
  'ONCE',
  'ONLY',
  'OPEN',
  'OVER',
  'PAID',
  'PART',
  'PAST',
  'PLAN',
  'PLAY',
  'PULL',
  'PUSH',
  'RATE',
  'READ',
  'REAL',
  'REST',
  'RISE',
  'RISK',
  'ROAD',
  'ROLE',
  'ROSE',
  'RULE',
  'SAFE',
  'SAID',
  'SAME',
  'SELL',
  'SEND',
  'SHOW',
  'SIDE',
  'SIGN',
  'SIZE',
  'SOLD',
  'SOME',
  'STAY',
  'STEP',
  'STOP',
  'SUCH',
  'SURE',
  'TAKE',
  'TALK',
  'TELL',
  'TERM',
  'TEST',
  'THAN',
  'THAT',
  'THEM',
  'THEN',
  'THEY',
  'THIS',
  'THUS',
  'TIME',
  'TOLD',
  'TOOK',
  'TURN',
  'UNIT',
  'UPON',
  'VERY',
  'WANT',
  'WEEK',
  'WELL',
  'WENT',
  'WERE',
  'WHAT',
  'WHEN',
  'WHOM',
  'WIDE',
  'WILL',
  'WITH',
  'WORD',
  'WORK',
  'YEAR',
  'YOUR',
]);

// Cashtag pattern: $AAPL, $BTC
const CASHTAG_RE = /\$([A-Z]{1,5})\b/g;

// Exchange-prefixed: NASDAQ:AAPL, NYSE:TSLA
const EXCHANGE_RE = /\b(?:NASDAQ|NYSE|AMEX|LSE|TSE|ASX):([A-Z]{1,5})\b/g;

// Crypto pairs: BTC-USD, ETH-USDT
const CRYPTO_PAIR_RE = /\b([A-Z]{2,5})-(USD|USDT|EUR|GBP|BTC|ETH)\b/g;

/**
 * Common asset name → ticker mapping for natural language extraction.
 * Keys are lowercase; values are the canonical ticker symbol.
 * This catches references like "bitcoin" → BTC, "gamestop" → GME.
 */
const NAME_TO_TICKER: ReadonlyMap<string, string> = new Map([
  // Crypto
  ['bitcoin', 'BTC'],
  ['btc', 'BTC'],
  ['ethereum', 'ETH'],
  ['ether', 'ETH'],
  ['solana', 'SOL'],
  ['cardano', 'ADA'],
  ['dogecoin', 'DOGE'],
  ['polkadot', 'DOT'],
  ['polygon', 'MATIC'],
  ['avalanche', 'AVAX'],
  ['chainlink', 'LINK'],
  ['litecoin', 'LTC'],
  ['ripple', 'XRP'],
  ['tether', 'USDT'],
  ['uniswap', 'UNI'],
  ['shiba inu', 'SHIB'],
  ['celestia', 'TIA'],
  ['lido', 'LDO'],
  ['near protocol', 'NEAR'],
  ['optimism protocol', 'OP'],
  ['zcash', 'ZEC'],
  ['qubic', 'QUBIC'],
  // Mega-cap equities commonly referenced by name
  ['apple', 'AAPL'],
  ['microsoft', 'MSFT'],
  ['google', 'GOOG'],
  ['alphabet', 'GOOG'],
  ['amazon', 'AMZN'],
  ['tesla', 'TSLA'],
  ['nvidia', 'NVDA'],
  ['meta platforms', 'META'],
  ['netflix', 'NFLX'],
  ['gamestop', 'GME'],
  ['palantir', 'PLTR'],
  ['coinbase', 'COIN'],
  ['microstrategy', 'MSTR'],
]);

/**
 * Build a regex that matches any known name as a whole word (case-insensitive).
 * Multi-word names (e.g. "shiba inu") are matched first (sorted by length desc).
 */
const NAME_PATTERNS = [...NAME_TO_TICKER.keys()].sort((a, b) => b.length - a.length);
const NAME_RE = new RegExp(`\\b(${NAME_PATTERNS.map(escapeRegex).join('|')})\\b`, 'gi');

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Interface for pluggable symbol resolution (future SymbolIndex integration).
 */
export interface SymbolResolver {
  /** Returns true if the ticker is a known traded symbol. */
  isKnownSymbol(ticker: string): boolean;
}

/**
 * Extract ticker symbols from text using regex patterns.
 *
 * Returns deduplicated, sorted array of tickers.
 */
export function extractTickers(text: string, resolver?: SymbolResolver): string[] {
  const tickers = new Set<string>();

  // Cashtags — high confidence, always include
  for (const match of text.matchAll(CASHTAG_RE)) {
    const ticker = match[1];
    if (!FALSE_POSITIVES.has(ticker)) {
      tickers.add(ticker);
    }
  }

  // Exchange-prefixed — high confidence
  for (const match of text.matchAll(EXCHANGE_RE)) {
    tickers.add(match[1]);
  }

  // Crypto pairs — preserve the pair AND extract the base ticker
  // e.g. "BTC-USD" → both "BTC-USD" (pair) and "BTC" (base)
  for (const match of text.matchAll(CRYPTO_PAIR_RE)) {
    tickers.add(`${match[1]}-${match[2]}`);
    tickers.add(match[1]);
  }

  // Known asset names in natural language (e.g. "bitcoin" → BTC, "gamestop" → GME)
  for (const match of text.matchAll(NAME_RE)) {
    const name = match[1].toLowerCase();
    const ticker = NAME_TO_TICKER.get(name);
    if (ticker && !FALSE_POSITIVES.has(ticker)) {
      tickers.add(ticker);
    }
  }

  // If a SymbolResolver is available, validate ambiguous matches
  if (resolver) {
    for (const ticker of tickers) {
      if (!resolver.isKnownSymbol(ticker)) {
        tickers.delete(ticker);
      }
    }
  }

  return [...tickers].sort();
}
