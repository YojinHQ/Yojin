/**
 * Hono HTTP server with GraphQL (graphql-yoga) mounted at /graphql.
 *
 * Provides:
 *   - GET  /api/health   — health check endpoint
 *   - ALL  /graphql      — GraphQL API (queries, mutations, subscriptions)
 *
 * Usage:
 *   import { startServer } from './server.js';
 *   await startServer();           // listens on port 3000 by default
 *   await startServer({ port: 4000 });
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';

import { createGraphQLServer } from './graphql/index.js';
import { createSubsystemLogger } from '../logging/index.js';

const log = createSubsystemLogger('api');

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono();

// Health check
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'yojin-api',
    timestamp: new Date().toISOString(),
  }),
);

// Mount graphql-yoga
const yoga = createGraphQLServer();

app.on(['GET', 'POST', 'OPTIONS'], '/graphql', async (c) => {
  const response = await yoga.handle(c.req.raw);
  return response;
});

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

export interface ServerOptions {
  port?: number;
  hostname?: string;
}

/**
 * Start the HTTP server. Resolves when the server is listening.
 */
export function startServer(opts: ServerOptions = {}): ReturnType<typeof serve> {
  const port = opts.port ?? (Number(process.env.YOJIN_API_PORT) || 3000);
  const hostname = opts.hostname ?? '0.0.0.0';

  const server = serve({ fetch: app.fetch, port, hostname }, () => {
    log.info(`Yojin API server listening on http://${hostname}:${port}`);
    log.info(`GraphQL endpoint: http://${hostname}:${port}/graphql`);
  });

  return server;
}

export { app };
