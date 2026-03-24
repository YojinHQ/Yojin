import type { JintelClient } from '@yojinhq/jintel-client';

import type { PriceOutcome, PriceProvider } from '../memory/types.js';

export interface PriceProviderOptions {
  getClient: () => JintelClient | undefined;
}

export function createJintelPriceProvider(options: PriceProviderOptions): PriceProvider {
  // NOTE: The Jintel batchQuotes endpoint returns only the current-day snapshot.
  // `_since` is intentionally ignored because no historical endpoint is available.
  // As a result, `priceAtAnalysis` approximates the baseline as previousClose
  // (yesterday's close), and `highInPeriod` / `lowInPeriod` reflect today's
  // intraday range only — not the full range since `_since`.
  return async (ticker: string, _since: Date): Promise<PriceOutcome> => {
    const client = options.getClient();
    if (!client) {
      throw new Error(`Failed to fetch price for ${ticker}: Jintel client not configured`);
    }
    const result = await client.quotes([ticker]);
    if (!result.success) {
      throw new Error(`Failed to fetch price for ${ticker}: ${result.error}`);
    }
    const quote = result.data.find((q) => q.ticker === ticker);
    if (!quote) {
      throw new Error(`No quote returned for ticker "${ticker}"`);
    }
    const priceAtAnalysis = quote.previousClose ?? quote.open ?? quote.price;
    const priceNow = quote.price;
    const returnPct = priceAtAnalysis !== 0 ? ((priceNow - priceAtAnalysis) / priceAtAnalysis) * 100 : 0;
    return {
      priceAtAnalysis,
      priceNow,
      returnPct,
      highInPeriod: quote.high ?? priceNow,
      lowInPeriod: quote.low ?? priceNow,
    };
  };
}
