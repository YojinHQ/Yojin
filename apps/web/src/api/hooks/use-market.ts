import { useQuery, useSubscription } from 'urql';

import { QUOTE_QUERY, NEWS_QUERY, SEARCH_SYMBOLS_QUERY, ON_PRICE_MOVE_SUBSCRIPTION } from '../documents.js';
import type {
  QuoteQueryResult,
  QuoteQueryVariables,
  SearchSymbolsQueryResult,
  SearchSymbolsQueryVariables,
  NewsQueryResult,
  NewsQueryVariables,
  OnPriceMoveSubscriptionResult,
  OnPriceMoveVariables,
  PriceEvent,
} from '../types.js';

/** Real-time quote for a single symbol. Pauses when no symbol is provided. */
export function useQuote(symbol: string | undefined) {
  return useQuery<QuoteQueryResult, QuoteQueryVariables>({
    query: QUOTE_QUERY,
    variables: { symbol: symbol ?? '' },
    pause: !symbol,
  });
}

/** Search symbols via Jintel. Pauses when query is empty. */
export function useSearchSymbols(query: string, limit?: number) {
  return useQuery<SearchSymbolsQueryResult, SearchSymbolsQueryVariables>({
    query: SEARCH_SYMBOLS_QUERY,
    variables: { query, limit },
    pause: !query.trim(),
  });
}

/** News articles, optionally filtered by symbol and limited in count. */
export function useNews(variables?: NewsQueryVariables) {
  return useQuery<NewsQueryResult, NewsQueryVariables>({
    query: NEWS_QUERY,
    variables: variables ?? {},
  });
}

/**
 * Subscribe to price move events for a specific symbol.
 *
 * Only fires when the absolute change percent exceeds the threshold.
 * Pauses when symbol is undefined.
 */
export function useOnPriceMove(
  symbol: string | undefined,
  threshold: number,
  handler?: (events: PriceEvent[], newEvent: PriceEvent) => PriceEvent[],
) {
  const defaultHandler = (prev: PriceEvent[] = [], response: OnPriceMoveSubscriptionResult): PriceEvent[] => [
    response.onPriceMove,
    ...prev,
  ];

  const customHandler = handler
    ? (prev: PriceEvent[] = [], response: OnPriceMoveSubscriptionResult): PriceEvent[] =>
        handler(prev, response.onPriceMove)
    : defaultHandler;

  return useSubscription<OnPriceMoveSubscriptionResult, PriceEvent[], OnPriceMoveVariables>(
    {
      query: ON_PRICE_MOVE_SUBSCRIPTION,
      variables: { symbol: symbol ?? '', threshold },
      pause: !symbol,
    },
    customHandler,
  );
}
