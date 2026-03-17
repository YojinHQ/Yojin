/**
 * Live subscription resolvers — onAlert, onPortfolioUpdate, onPriceMove.
 */

import { pubsub } from '../pubsub.js';
import type { PriceEvent } from '../types.js';

// ---------------------------------------------------------------------------
// Subscription resolvers
// ---------------------------------------------------------------------------

export const onAlertSubscription = {
  subscribe: () => pubsub.subscribe('alert'),
  resolve: (payload: unknown) => payload,
};

export const onPortfolioUpdateSubscription = {
  subscribe: () => pubsub.subscribe('portfolioUpdate'),
  resolve: (payload: unknown) => payload,
};

export const onPriceMoveSubscription = {
  subscribe: (_parent: unknown, args: { symbol: string; threshold: number }) => {
    // Filter price events by symbol and threshold
    const source = pubsub.subscribe('priceMove');

    return {
      [Symbol.asyncIterator]() {
        const iterator = source[Symbol.asyncIterator]();
        return {
          async next() {
            while (true) {
              const result = await iterator.next();
              if (result.done) return result;

              const event = result.value as PriceEvent;
              if (event.symbol === args.symbol && Math.abs(event.changePercent) >= args.threshold) {
                return result;
              }
            }
          },
          return: iterator.return?.bind(iterator),
          throw: iterator.throw?.bind(iterator),
        };
      },
    };
  },
  resolve: (payload: unknown) => payload,
};
