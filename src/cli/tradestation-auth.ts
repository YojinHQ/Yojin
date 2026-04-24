/**
 * `yojin tradestation-auth` — one-time TradeStation OAuth setup.
 *
 * Runs the Authorization Code flow: starts a localhost HTTP listener on the
 * configured callback port (default :31022, must be on TradeStation's redirect
 * allowlist), opens the consent URL in the user's browser, captures the code
 * from the callback, exchanges it for an access_token + refresh_token, and
 * persists the three credentials (client_id, client_secret, refresh_token) to
 * the encrypted vault.
 *
 * After this runs once, the TradeStationApiConnector uses the stored
 * refresh_token to mint short-lived access_tokens for every portfolio sync.
 *
 * TTY-only. Vault passphrase comes from YOJIN_VAULT_PASSPHRASE (same pattern
 * as `yojin secret`).
 */

import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import * as readline from 'node:readline';
import { URL } from 'node:url';

import { z } from 'zod';

import { onShutdownSignal } from './shutdown-signals.js';
import { FileAuditLog } from '../trust/audit/audit-log.js';
import { EncryptedVault } from '../trust/vault/vault.js';

const TOKEN_URL = 'https://signin.tradestation.com/oauth/token';
const AUTHORIZE_URL = 'https://signin.tradestation.com/authorize';
const AUDIENCE = 'https://api.tradestation.com';
const SCOPE = 'openid offline_access profile MarketData ReadAccount';
// TradeStation's default redirect allowlist (per auth-code docs).
const ALLOWED_CALLBACK_PORTS = new Set([80, 3000, 3001, 8080, 31022]);
const DEFAULT_CALLBACK_PORT = 31022;
const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;

// Shared with TradeStationApiConnector — don't trust the wire.
const TokenExchangeResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
});

interface ParsedArgs {
  callbackPort: number;
  help: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  let callbackPort = DEFAULT_CALLBACK_PORT;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--callback-port') {
      const raw = args[++i];
      const n = Number(raw);
      if (!Number.isInteger(n) || !ALLOWED_CALLBACK_PORTS.has(n)) {
        throw new Error(
          `Invalid --callback-port "${raw ?? ''}". Must be one of: ${[...ALLOWED_CALLBACK_PORTS].join(', ')} ` +
            "(TradeStation's default redirect allowlist).",
        );
      }
      callbackPort = n;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { callbackPort, help };
}

function printHelp(): void {
  console.error('Usage: yojin tradestation-auth [--callback-port <port>]');
  console.error('');
  console.error('One-time OAuth setup for TradeStation. Opens a browser for');
  console.error('consent, captures the code via a localhost listener, and stores');
  console.error('TRADESTATION_CLIENT_ID, TRADESTATION_CLIENT_SECRET, and');
  console.error('TRADESTATION_REFRESH_TOKEN in the encrypted vault.');
  console.error('');
  console.error('Options:');
  console.error(`  --callback-port <port>   Redirect listener port. One of: ${[...ALLOWED_CALLBACK_PORTS].join(', ')}`);
  console.error(`                           (default: ${DEFAULT_CALLBACK_PORT})`);
  console.error('');
  console.error('Requires YOJIN_VAULT_PASSPHRASE to be set (same as `yojin secret`).');
}

function getPassphrase(): string {
  const passphrase = process.env.YOJIN_VAULT_PASSPHRASE;
  if (!passphrase) {
    throw new Error(
      'YOJIN_VAULT_PASSPHRASE environment variable is required. Set it before running tradestation-auth.',
    );
  }
  return passphrase;
}

function requireTty(): void {
  if (!process.stdin.isTTY) {
    console.error('Error: tradestation-auth requires an interactive terminal (TTY).');
    console.error('This prevents automated agents from capturing secret values.');
    process.exit(1);
  }
}

/**
 * Read a line from the terminal. Prompt goes to stderr so LLM agents reading
 * stdout cannot see it.
 */
async function readLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Read a secret from the terminal with echo disabled. Never printed.
 * Matches the pattern in src/trust/vault/cli.ts:readSecretFromTty.
 */
async function readSecretFromTty(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let input = '';

    if (typeof stdin.setRawMode !== 'function') {
      process.stderr.write('\n');
      reject(new Error('Hidden input is not supported on this terminal.'));
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (char: string): void => {
      const code = char.charCodeAt(0);
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        resolve(input);
      } else if (code === 3) {
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        reject(new Error('Cancelled'));
      } else if (code === 127 || code === 8) {
        if (input.length > 0) input = input.slice(0, -1);
      } else if (code >= 32) {
        input += char;
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Open the given URL in the user's default browser. Uses execFile (not exec)
 * to avoid shell quoting issues. Falls back to printing the URL if launching
 * the browser fails.
 */
function openBrowser(url: string): void {
  const [cmd, ...cmdArgs] =
    process.platform === 'darwin'
      ? (['open', url] as const)
      : process.platform === 'win32'
        ? (['cmd', '/c', 'start', '', url] as const)
        : (['xdg-open', url] as const);
  execFile(cmd, [...cmdArgs], (err) => {
    if (err) {
      console.error(`Could not launch browser automatically: ${err.message}`);
      console.error(`Open this URL manually: ${url}`);
    }
  });
}

interface CallbackResult {
  code: string;
}

/**
 * Start the callback listener. Resolves with the authorization code once
 * TradeStation redirects back with `?code=...&state=...`. Rejects on state
 * mismatch, explicit `error=...`, or the overall consent timeout.
 *
 * The returned server handle can be closed by signal handlers or `finally`
 * blocks in the caller.
 */
function awaitCallback(servers: Server[], port: number, expectedState: string): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('User did not complete consent within 5 minutes.'));
    }, CONSENT_TIMEOUT_MS);

    const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
      if (!req.url) return;
      const url = new URL(req.url, `http://localhost:${port}`);
      const error = url.searchParams.get('error');
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');

      if (error) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end(`<html><body><h1>Consent failed</h1><p>${error}</p></body></html>`);
        clearTimeout(timeout);
        reject(new Error(`TradeStation consent returned error: ${error}`));
        return;
      }
      if (state !== expectedState) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end('<html><body><h1>State mismatch</h1><p>Possible CSRF attack.</p></body></html>');
        clearTimeout(timeout);
        reject(new Error('OAuth state parameter mismatch — aborting.'));
        return;
      }
      if (!code) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end('<html><body><h1>Missing code</h1></body></html>');
        clearTimeout(timeout);
        reject(new Error('Callback did not include an authorization code.'));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body><h1>Success</h1><p>You can close this tab and return to the terminal.</p></body></html>');
      clearTimeout(timeout);
      resolve({ code });
    };

    for (const s of servers) s.on('request', handleRequest);
  });
}

async function exchangeCodeForTokens(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
  });
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    throw new Error(`TradeStation token exchange failed (${resp.status}): ${await resp.text()}`);
  }
  const parsed = TokenExchangeResponseSchema.safeParse(await resp.json());
  if (!parsed.success) {
    throw new Error(`TradeStation token response malformed: ${parsed.error.message}`);
  }
  return {
    refreshToken: parsed.data.refresh_token,
    accessToken: parsed.data.access_token,
    expiresIn: parsed.data.expires_in,
  };
}

export async function runTradeStationAuth(args: string[]): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    printHelp();
    process.exit(1);
  }

  if (parsed.help) {
    printHelp();
    return;
  }

  requireTty();

  const auditLog = new FileAuditLog();
  const vault = new EncryptedVault({ auditLog });
  await vault.unlock(getPassphrase());

  console.error('TradeStation OAuth setup');
  console.error('------------------------');
  console.error("You'll need your TradeStation API Key (client_id) and API Secret (client_secret).");
  console.error('These come from https://api.tradestation.com/docs/ — "Get API Key".');
  console.error('');

  const clientId = (await readLine('Enter your TradeStation API Key (client_id): ')).trim();
  if (!clientId) {
    console.error('Error: empty client_id.');
    process.exit(1);
  }
  const clientSecret = await readSecretFromTty('Enter your TradeStation API Secret (client_secret): ');
  if (!clientSecret) {
    console.error('Error: empty client_secret.');
    process.exit(1);
  }

  const redirectUri = `http://localhost:${parsed.callbackPort}`;
  const state = randomBytes(16).toString('hex');
  const authorizeUrl =
    `${AUTHORIZE_URL}?response_type=code` +
    `&client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&audience=${encodeURIComponent(AUDIENCE)}` +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&state=${encodeURIComponent(state)}`;

  // Bind both IPv4 and IPv6 loopback. TradeStation's redirect_uri allowlist
  // requires `http://localhost:<port>` (not `127.0.0.1`), and the browser may
  // resolve `localhost` to either `::1` or `127.0.0.1` depending on platform
  // + DNS config. Binding only one address family causes the callback to miss
  // the listener on the other family. Two listeners, same handler.
  const serverV4 = createServer();
  const serverV6 = createServer();
  const servers = [serverV4, serverV6];
  const shutdown = (): void => {
    void closeAll(servers).finally(() => process.exit(1));
  };
  onShutdownSignal(shutdown);

  try {
    await Promise.all([
      listenOn(serverV4, parsed.callbackPort, '127.0.0.1'),
      // Skip only EAFNOSUPPORT (system has no IPv6 stack). EADDRINUSE on ::1
      // means another process owns [::1]:port and MUST be surfaced — silently
      // falling back to v4-only would let the browser's IPv6 callback hit that
      // other process instead of us.
      listenOn(serverV6, parsed.callbackPort, '::1').catch((err: NodeJS.ErrnoException) => {
        if (err.code === 'EAFNOSUPPORT') return;
        throw err;
      }),
    ]);

    console.error(`Listening on ${redirectUri} — opening your browser for consent...`);
    openBrowser(authorizeUrl);
    console.error(`If the browser didn't open, visit:\n  ${authorizeUrl}\n`);

    const { code } = await awaitCallback(servers, parsed.callbackPort, state);

    console.error('Exchanging authorization code for tokens...');
    const { refreshToken } = await exchangeCodeForTokens({
      clientId,
      clientSecret,
      code,
      redirectUri,
    });

    await setSecretsAtomically(vault, [
      ['TRADESTATION_CLIENT_ID', clientId],
      ['TRADESTATION_CLIENT_SECRET', clientSecret],
      ['TRADESTATION_REFRESH_TOKEN', refreshToken],
    ]);

    console.error('');
    console.error('Success. Stored:');
    console.error('  - TRADESTATION_CLIENT_ID');
    console.error('  - TRADESTATION_CLIENT_SECRET');
    console.error('  - TRADESTATION_REFRESH_TOKEN');
    console.error('');
    console.error('Run `yojin start` to begin syncing your TradeStation portfolio.');
  } finally {
    await closeAll(servers);
  }
}

/**
 * Bind a server with a clear EADDRINUSE error message.
 */
function listenOn(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${port} (${host}) is already in use. Pass --callback-port with one of: ` +
              `${[...ALLOWED_CALLBACK_PORTS].join(', ')}`,
          ),
        );
      } else {
        reject(err);
      }
    });
    server.listen(port, host, () => resolve());
  });
}

async function closeAll(servers: Server[]): Promise<void> {
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          if (!s.listening) {
            resolve();
            return;
          }
          s.close(() => resolve());
        }),
    ),
  );
}

/**
 * Write all three secrets to the vault or none. If any write fails, roll back
 * the earlier ones so the vault never contains a partially-populated credential
 * set (which would make the connector's `isAvailable()` return false anyway,
 * but leave the user to hunt down which key is missing).
 *
 * NOTE: best-effort — not atomic across a process crash. The underlying vault
 * persists each `set()` immediately, so a SIGKILL mid-rollback can leave
 * partial state. Re-running `yojin tradestation-auth` is the recovery path;
 * it overwrites any partial entries cleanly.
 */
async function setSecretsAtomically(vault: EncryptedVault, entries: Array<[string, string]>): Promise<void> {
  const written: string[] = [];
  try {
    for (const [key, value] of entries) {
      await vault.set(key, value);
      written.push(key);
    }
  } catch (err) {
    for (const key of written.reverse()) {
      try {
        await vault.delete(key);
      } catch {
        // Best-effort rollback; surfacing this would mask the original cause.
      }
    }
    throw err;
  }
}
