import { describe, expect, it } from 'vitest';

import { extractTickers } from '../../src/signals/ticker-extractor.js';
import type { SymbolResolver } from '../../src/signals/ticker-extractor.js';

describe('extractTickers', () => {
  it('extracts cashtag tickers', () => {
    expect(extractTickers('$AAPL is up 5% today')).toEqual(['AAPL']);
  });

  it('extracts multiple cashtags', () => {
    expect(extractTickers('$AAPL and $TSLA both rallied, $MSFT flat')).toEqual(['AAPL', 'MSFT', 'TSLA']);
  });

  it('deduplicates cashtags', () => {
    expect(extractTickers('$AAPL beats earnings, $AAPL stock soars')).toEqual(['AAPL']);
  });

  it('filters false positive cashtags', () => {
    expect(extractTickers('$THE market is $UP today')).toEqual([]);
  });

  it('extracts NASDAQ:TICKER format', () => {
    expect(extractTickers('NASDAQ:AAPL hit new highs')).toEqual(['AAPL']);
  });

  it('extracts NYSE:TICKER format', () => {
    expect(extractTickers('NYSE:BA dropped after grounding')).toEqual(['BA']);
  });

  it('extracts crypto pairs as -USD tickers plus base name', () => {
    // "BTC" in "BTC-USD" also matches the name map → both BTC and BTC-USD
    expect(extractTickers('BTC-USD broke $70k resistance')).toEqual(['BTC', 'BTC-USD']);
  });

  it('preserves crypto pair quote currency', () => {
    expect(extractTickers('ETH-USDT trading at $3500')).toEqual(['ETH', 'ETH-USDT']);
    expect(extractTickers('BTC-EUR trading at 50000')).toEqual(['BTC', 'BTC-EUR']);
    expect(extractTickers('SOL-USD price update')).toEqual(['SOL', 'SOL-USD']);
  });

  it('combines cashtags, exchange-prefixed, and crypto pairs', () => {
    const text = '$AAPL rallied while NASDAQ:MSFT was flat. BTC-USD surged past $70k.';
    expect(extractTickers(text)).toEqual(['AAPL', 'BTC', 'BTC-USD', 'MSFT']);
  });

  it('returns empty array for text with no tickers', () => {
    expect(extractTickers('The Federal Reserve held rates steady today.')).toEqual([]);
  });

  it('returns sorted results', () => {
    expect(extractTickers('$TSLA $AAPL $MSFT')).toEqual(['AAPL', 'MSFT', 'TSLA']);
  });

  it('filters tickers through SymbolResolver when provided', () => {
    const resolver: SymbolResolver = {
      isKnownSymbol: (t) => t === 'AAPL' || t === 'TSLA',
    };
    expect(extractTickers('$AAPL $XYZZ $TSLA', resolver)).toEqual(['AAPL', 'TSLA']);
  });

  it('removes all tickers if resolver rejects them', () => {
    const resolver: SymbolResolver = { isKnownSymbol: () => false };
    expect(extractTickers('$AAPL $TSLA', resolver)).toEqual([]);
  });

  // Name-to-ticker extraction
  it('extracts "bitcoin" as BTC', () => {
    expect(extractTickers("GameStop's move to add bitcoin as a treasury asset")).toEqual(['BTC', 'GME']);
  });

  it('extracts crypto names case-insensitively', () => {
    expect(extractTickers('Bitcoin and Ethereum are both up today')).toEqual(['BTC', 'ETH']);
  });

  it('extracts multi-word names like "shiba inu"', () => {
    expect(extractTickers('Shiba Inu surges 20% on exchange listing')).toEqual(['SHIB']);
  });

  it('extracts equity names like "gamestop" and "nvidia"', () => {
    expect(extractTickers('Nvidia earnings beat expectations while GameStop fell')).toEqual(['GME', 'NVDA']);
  });

  it('deduplicates name-extracted and cashtag-extracted tickers', () => {
    expect(extractTickers('$BTC bitcoin price surges')).toEqual(['BTC']);
  });

  it('extracts "microstrategy" as MSTR', () => {
    expect(extractTickers("MicroStrategy's bitcoin holdings grow")).toEqual(['BTC', 'MSTR']);
  });

  it('does not false-positive on common words like "strategy", "meta", and "optimism"', () => {
    // "strategy" is too common in financial text — should not tag MSTR
    expect(extractTickers('investment strategy for 2026')).toEqual([]);
    // "meta" as a standalone word or hyphenated prefix — should not tag META
    expect(extractTickers('The metadata contains no useful metaphor')).toEqual([]);
    expect(extractTickers('A meta-analysis of hedge fund returns')).toEqual([]);
    // "optimism" is common in financial writing — should not tag OP
    expect(extractTickers('market optimism lifted equities')).toEqual([]);
    expect(extractTickers('cautious optimism about rate cuts')).toEqual([]);
  });

  it('extracts "meta platforms" as META', () => {
    expect(extractTickers('Meta Platforms reports strong ad revenue')).toEqual(['META']);
  });
});
