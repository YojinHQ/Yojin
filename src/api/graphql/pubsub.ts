/**
 * PubSub for GraphQL subscriptions.
 *
 * Uses graphql-yoga's built-in createPubSub for type-safe event delivery.
 * Real event sources (alert engine, scraper, price feed) will publish here.
 */

import { createPubSub } from 'graphql-yoga';

import type { Alert, ChatEvent, PortfolioSnapshot, PriceEvent } from './types.js';
import type { ConnectionEvent } from '../../scraper/types.js';

export type PubSubEvents = {
  alert: [Alert];
  portfolioUpdate: [PortfolioSnapshot];
  priceMove: [PriceEvent];
  [key: `chat:${string}`]: [ChatEvent];
  [key: `connectionStatus:${string}`]: [ConnectionEvent];
};

export const pubsub = createPubSub<PubSubEvents>();
