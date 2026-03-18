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

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { mountGraphQL } from './graphql/server.js';
import { createSubsystemLogger } from '../logging/index.js';

const log = createSubsystemLogger('api');

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------

const app = new Hono();

// CORS — allow the web app origin in dev; configurable via env for production
app.use(
  '/graphql',
  cors({
    origin: process.env.YOJIN_CORS_ORIGIN ?? 'http://localhost:5173',
  }),
);

// Health check
app.get('/api/health', (c) =>
  c.json({
    status: 'ok',
    service: 'yojin-api',
    timestamp: new Date().toISOString(),
  }),
);

// Mount graphql-yoga
mountGraphQL(app);

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
