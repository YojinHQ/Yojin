/**
 * GraphQL server — graphql-yoga mounted on Hono.
 *
 * Creates the yoga instance and exports a function to mount it on a Hono app.
 */

import { createSchema, createYoga } from 'graphql-yoga';
import type { Hono } from 'hono';

import { alertsQuery, createAlertMutation, dismissAlertMutation } from './resolvers/alerts.js';
import { onAlertSubscription, onPortfolioUpdateSubscription, onPriceMoveSubscription } from './resolvers/live.js';
import { newsQuery, quoteQuery, sectorExposureQuery } from './resolvers/market.js';
import {
  enrichedSnapshotQuery,
  portfolioQuery,
  positionsQuery,
  refreshPositionsMutation,
} from './resolvers/portfolio.js';
import { riskReportQuery } from './resolvers/risk.js';
import { typeDefs } from './schema.js';

const schema = createSchema({
  typeDefs,
  resolvers: {
    Query: {
      portfolio: portfolioQuery,
      positions: positionsQuery,
      enrichedSnapshot: enrichedSnapshotQuery,
      riskReport: riskReportQuery,
      alerts: alertsQuery,
      news: newsQuery,
      quote: quoteQuery,
      sectorExposure: sectorExposureQuery,
    },
    Mutation: {
      refreshPositions: refreshPositionsMutation,
      createAlert: createAlertMutation,
      dismissAlert: dismissAlertMutation,
    },
    Subscription: {
      onAlert: onAlertSubscription,
      onPortfolioUpdate: onPortfolioUpdateSubscription,
      onPriceMove: onPriceMoveSubscription,
    },
  },
});

const yoga = createYoga({
  schema,
  graphqlEndpoint: '/graphql',
  graphiql: process.env.NODE_ENV !== 'production',
  // CORS handled by Hono middleware in the web channel — no duplicate headers
  cors: false,
});

/**
 * Mount the GraphQL yoga handler on a Hono app.
 */
export function mountGraphQL(app: Hono): void {
  app.on(['GET', 'POST', 'OPTIONS'], '/graphql', async (c) => {
    const response = await yoga.handle(c.req.raw, {});
    return response;
  });
}

export { schema, yoga };
