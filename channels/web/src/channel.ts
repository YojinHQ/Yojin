/**
 * Web channel plugin implementation.
 *
 * Serves the GraphQL API, chat endpoints, SSE streaming, and the built React
 * dashboard (apps/web/dist) as static assets over Hono.
 */

import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ServerType, serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';

import { mountGraphQL } from '../../../src/api/graphql/server.js';
import { resolveDataRoot } from '../../../src/paths.js';
import type {
  ChannelAuthAdapter,
  ChannelCapabilities,
  ChannelMessagingAdapter,
  ChannelPlugin,
  ChannelSetupAdapter,
  IncomingMessage,
  OutgoingMessage,
} from '../../../src/plugins/types.js';

const PORT_FALLBACK_ATTEMPTS = 10;

/**
 * `@hono/node-server` does not re-export its `Options.fetch` type, so we pin
 * to the first positional argument of `serve` and extract `fetch` from it.
 * This stays in sync with whatever `serve` accepts across versions.
 */
type ServeFetch = Parameters<typeof serve>[0]['fetch'];

// Resolve the bundled React dashboard relative to this module so it works in
// both local dev (`dist/channels/web/src/channel.js`) and the published npm
// package (`<pkg>/dist/channels/web/src/channel.js`). Four levels up lands on
// the package root; from there we descend into apps/web/dist.
const WEB_DIST_DIR = fileURLToPath(new URL('../../../../apps/web/dist/', import.meta.url));

const STATIC_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

async function readDashboardFile(requestPath: string): Promise<{ body: ArrayBuffer; mime: string } | null> {
  const cleaned = normalize(requestPath).replace(/^[\\/]+/, '');
  const filePath = resolvePath(WEB_DIST_DIR, cleaned);
  // Reject any path that escapes the dashboard dir.
  if (!filePath.startsWith(WEB_DIST_DIR)) return null;
  try {
    const buf = await readFile(filePath);
    // Copy into a fresh ArrayBuffer so the Response body type is unambiguous
    // (Node Buffer's backing store is typed as ArrayBufferLike, which isn't
    // assignable to BodyInit under strict lib.dom.d.ts).
    const body = new ArrayBuffer(buf.byteLength);
    new Uint8Array(body).set(buf);
    const mime = STATIC_MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    return { body, mime };
  } catch {
    return null;
  }
}

async function dashboardAvailable(): Promise<boolean> {
  try {
    const info = await stat(resolvePath(WEB_DIST_DIR, 'index.html'));
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * Try to bind `serve()` to `port`. If the port is already in use, probe the
 * next N ports. Resolves with the bound server and the port that actually
 * worked (which may differ from the requested one).
 */
async function listenWithFallback(opts: {
  fetch: ServeFetch;
  port: number;
  hostname: string;
  maxAttempts: number;
}): Promise<{ server: ServerType; boundPort: number }> {
  let lastError: Error | undefined;
  for (let offset = 0; offset < opts.maxAttempts; offset++) {
    const candidate = opts.port + offset;
    try {
      const s = await tryListen(opts.fetch, candidate, opts.hostname);
      return { server: s, boundPort: candidate };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE') throw err;
      lastError = err as Error;
    }
  }
  throw new Error(
    `Could not bind to any port in range ${opts.port}-${opts.port + opts.maxAttempts - 1}. ` +
      `Last error: ${lastError?.message ?? 'unknown'}. ` +
      `Try a different port with \`yojin --port <n>\` or YOJIN_PORT=<n>.`,
  );
}

function tryListen(fetch: ServeFetch, port: number, hostname: string): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const s = serve({ fetch, port, hostname }, () => {
      if (settled) return;
      settled = true;
      resolve(s);
    });
    s.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      // Ensure the aborted server can't keep the event loop alive.
      try {
        s.close();
      } catch {
        // Best effort — the server may have never fully initialized.
      }
      reject(err);
    });
  });
}

/**
 * Print a clean, static "ready" banner once the server is listening.
 * Uses plain console.log so it bypasses the tslog console transport —
 * the splash is visible even when `--verbose` is off and tslog is hidden.
 */
function printSplash(opts: {
  hostname: string;
  boundPort: number;
  requestedPort: number;
  hasDashboard: boolean;
}): void {
  const { hostname, boundPort, requestedPort, hasDashboard } = opts;
  const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname;
  const base = `http://${displayHost}:${boundPort}`;
  const logPath = join(resolveDataRoot(), 'logs', 'latest.log');
  const wasFallback = boundPort !== requestedPort;

  const lines: string[] = [''];
  lines.push('  Yojin is ready.');
  lines.push('');
  if (hasDashboard) {
    lines.push(`    Dashboard   ${base}`);
  }
  lines.push(`    GraphQL     ${base}/graphql`);
  lines.push(`    Logs        ${logPath}`);
  if (wasFallback) {
    lines.push('');
    lines.push(`    Note: port ${requestedPort} was in use — listening on ${boundPort} instead.`);
    lines.push(`          Pin a specific port with \`yojin --port <n>\` or YOJIN_PORT=<n>.`);
  }
  if (!hasDashboard) {
    lines.push('');
    lines.push(`    Dashboard bundle not found. Run \`pnpm build:web\`, or use`);
    lines.push(`    \`pnpm dev\` for the Vite dev server on :5173.`);
  }
  lines.push('');
  lines.push('    Press Ctrl+C to stop.');
  lines.push('');
  console.log(lines.join('\n'));
}

type MessageHandler = (msg: IncomingMessage) => Promise<void>;

export function buildWebChannel(): ChannelPlugin {
  let server: ServerType | undefined;
  const app = new Hono();
  const messageHandlers: MessageHandler[] = [];

  const RESPONSE_TIMEOUT_MS = 30_000;

  // Track pending SSE responses by thread ID
  const pendingResponses = new Map<string, (text: string) => void>();

  /** Create a response promise with timeout to prevent hanging requests. */
  function createResponsePromise(threadId: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingResponses.delete(threadId);
        reject(new Error('Response timeout'));
      }, RESPONSE_TIMEOUT_MS);

      pendingResponses.set(threadId, (text: string) => {
        clearTimeout(timer);
        resolve(text);
      });
    });
  }

  const messagingAdapter: ChannelMessagingAdapter = {
    async sendMessage(msg: OutgoingMessage): Promise<void> {
      // Resolve pending SSE or chat response
      const threadId = msg.threadId ?? msg.channelId;
      const resolve = pendingResponses.get(threadId);
      if (resolve) {
        resolve(msg.text);
        pendingResponses.delete(threadId);
      }
    },
    onMessage(handler: MessageHandler): void {
      messageHandlers.push(handler);
    },
  };

  const authAdapter: ChannelAuthAdapter = {
    async validateToken(token: string): Promise<boolean> {
      // Simple bearer token validation — replaced by real auth later
      return token.length > 0;
    },
    getScopes() {
      return ['chat:read', 'chat:write', 'portfolio:read', 'alerts:manage'];
    },
  };

  const setupAdapter: ChannelSetupAdapter = {
    async setup(config: Record<string, unknown>): Promise<void> {
      const options = config.options as Record<string, string | number> | undefined;
      const port = Number(options?.port ?? process.env.YOJIN_PORT ?? 3000);

      // CORS for local development
      app.use(
        '*',
        cors({
          origin: ['http://localhost:5173', 'http://localhost:3000'],
          credentials: true,
        }),
      );

      // Health check
      app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

      // Mount GraphQL API
      mountGraphQL(app);

      // Share-image upload proxy — forwards a PNG to catbox.moe server-side.
      // catbox.moe returns no CORS headers, so browser uploads are blocked.
      // Routing through the local backend sidesteps CORS. Image types and
      // a 5 MB cap keep this from being usable as a generic file-upload abuse
      // vector if the web channel is ever reachable off-loopback.
      const SHARE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
      const SHARE_UPLOAD_ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
      app.post('/api/share-upload', async (c) => {
        try {
          const contentLength = Number(c.req.header('content-length') ?? '0');
          if (Number.isFinite(contentLength) && contentLength > SHARE_UPLOAD_MAX_BYTES + 1024) {
            return c.json({ error: 'Upload too large' }, 413);
          }
          const incoming = await c.req.formData();
          const file = incoming.get('file');
          if (!(file instanceof File)) {
            return c.json({ error: 'Missing file field' }, 400);
          }
          if (file.size > SHARE_UPLOAD_MAX_BYTES) {
            return c.json({ error: 'Upload too large' }, 413);
          }
          if (file.type && !SHARE_UPLOAD_ALLOWED_TYPES.has(file.type)) {
            return c.json({ error: 'Unsupported file type' }, 415);
          }
          const outgoing = new FormData();
          outgoing.append('reqtype', 'fileupload');
          outgoing.append('fileToUpload', file, file.name || 'share.png');
          const res = await fetch('https://catbox.moe/user/api.php', {
            method: 'POST',
            body: outgoing,
          });
          const body = (await res.text()).trim();
          // catbox sometimes returns a non-2xx status with a valid URL body;
          // treat any response starting with http(s):// as success.
          if (!body.startsWith('http')) {
            console.warn('[web] /api/share-upload failed', { status: res.status, body: body.slice(0, 200) });
            return c.json({ error: `Upload failed (${res.status})` }, 502);
          }
          return c.json({ url: body });
        } catch (err) {
          console.error('[web] /api/share-upload error:', err);
          return c.json({ error: err instanceof Error ? err.message : 'Upload failed' }, 500);
        }
      });

      // Chat endpoint — POST message, get response
      app.post('/api/chat', async (c) => {
        let threadId: string | undefined;
        try {
          const body = await c.req.json<{ message: string; threadId?: string }>().catch(() => null);
          if (!body || typeof body.message !== 'string' || !body.message.trim()) {
            return c.json({ error: 'Invalid request body' }, 400);
          }
          threadId = body.threadId ?? `web-${Date.now()}`;

          const incoming: IncomingMessage = {
            channelId: 'web',
            threadId,
            userId: 'web-user',
            text: body.message,
            timestamp: new Date().toISOString(),
          };

          const responsePromise = createResponsePromise(threadId);

          for (const handler of messageHandlers) {
            await handler(incoming);
          }

          try {
            const response = await responsePromise;
            return c.json({ threadId, response });
          } catch {
            return c.json({ error: 'Request timed out' }, 504);
          }
        } catch (err) {
          if (threadId) pendingResponses.delete(threadId);
          console.error('[web] /api/chat unhandled error:', err);
          return c.json({ error: 'Internal server error' }, 500);
        }
      });

      // SSE streaming endpoint
      app.get('/api/chat/stream', (c) => {
        const threadId = c.req.query('threadId') ?? `web-stream-${Date.now()}`;
        const message = c.req.query('message');

        if (!message) {
          return c.json({ error: 'message query parameter required' }, 400);
        }

        return streamSSE(c, async (stream) => {
          const incoming: IncomingMessage = {
            channelId: 'web',
            threadId,
            userId: 'web-user',
            text: message,
            timestamp: new Date().toISOString(),
          };

          const responsePromise = createResponsePromise(threadId);

          for (const handler of messageHandlers) {
            await handler(incoming);
          }

          try {
            const response = await responsePromise;

            await stream.writeSSE({
              event: 'message',
              data: JSON.stringify({ threadId, response }),
            });

            await stream.writeSSE({ event: 'done', data: '' });
          } catch {
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({ error: 'Request timed out' }),
            });
          }
        });
      });

      // Serve the bundled React dashboard (apps/web/dist) as static assets.
      // This makes `yojin start` self-contained for published npm installs —
      // no separate Vite dev server required. API routes above take precedence
      // because Hono matches in registration order; this handler is the last
      // fallback and only runs for paths that didn't hit /health, /graphql,
      // or /api/*.
      const hasDashboard = await dashboardAvailable();
      if (hasDashboard) {
        app.get('*', async (c) => {
          const url = new URL(c.req.url);
          // Never let static serving shadow API surface.
          if (url.pathname.startsWith('/graphql') || url.pathname.startsWith('/api/')) {
            return c.notFound();
          }
          const requested = url.pathname === '/' ? '/index.html' : url.pathname;
          const file = (await readDashboardFile(requested)) ?? (await readDashboardFile('/index.html'));
          if (!file) return c.notFound();
          return new Response(file.body, { headers: { 'content-type': file.mime } });
        });
      }
      // The missing-dashboard case is surfaced by printSplash() below so the
      // user sees it as part of the ready banner instead of a stray log line.

      // Bind to localhost only — this agent runs locally, not exposed to the network.
      // In Docker, set YOJIN_HOST=0.0.0.0 to allow container port mapping.
      const hostname = String(options?.hostname ?? process.env.YOJIN_HOST ?? '127.0.0.1');

      const { server: listening, boundPort } = await listenWithFallback({
        fetch: app.fetch,
        port,
        hostname,
        maxAttempts: PORT_FALLBACK_ATTEMPTS,
      });
      server = listening;

      printSplash({
        hostname,
        boundPort,
        requestedPort: port,
        hasDashboard,
      });
    },

    async teardown(): Promise<void> {
      if (server) {
        // Force-close all keep-alive / SSE connections so .close() resolves
        // immediately instead of waiting for clients to disconnect.
        // ServerType includes Http2Server which lacks this in its type defs,
        // but we always use Http1 and Node >= 18.2 provides it.
        (server as import('node:http').Server).closeAllConnections();
        await new Promise<void>((resolve, reject) => {
          server?.close((err) => (err ? reject(err) : resolve()));
        });
        server = undefined;
      }
    },
  };

  const capabilities: ChannelCapabilities = {
    supportsThreading: true,
    supportsReactions: false,
    supportsTyping: false,
    supportsFiles: false,
    supportsEditing: false,
  };

  return {
    id: 'web',
    name: 'Web',
    description: 'Web UI channel — GraphQL API + chat + SSE streaming',
    aliases: ['http', 'api'],
    messagingAdapter,
    authAdapter,
    setupAdapter,
    capabilities,

    async initialize(config): Promise<void> {
      const webConfig = config.channels?.find((c) => c.id === 'web');

      if (!webConfig?.enabled) {
        console.log('Web channel is disabled, skipping setup');
        return;
      }

      await setupAdapter.setup({ options: webConfig.options ?? {} });
    },

    async shutdown(): Promise<void> {
      await setupAdapter.teardown?.();
    },
  };
}
