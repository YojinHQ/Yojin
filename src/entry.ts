/**
 * Yojin entry point.
 */

import { runMain } from './cli/run-main.js';
import { initLogger } from './logging/index.js';

const args = process.argv.slice(2);

// Prevent unhandled rejections from crashing the server (e.g. CLI subprocess failures)
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// Node 22.6.0 throws ERR_INVALID_STATE when an SSE client disconnects and the
// ReadableStream has already been closed. Fixed in Node 22.12+ but caught here
// to keep the server alive on older versions.
process.on('uncaughtException', (err) => {
  if (err && 'code' in err && (err as NodeJS.ErrnoException).code === 'ERR_INVALID_STATE') {
    console.warn('[uncaughtException] Ignored ERR_INVALID_STATE (likely SSE close race)', err.stack);
    return;
  }
  console.error('[uncaughtException]', err);
  process.exit(1);
});

// Hide console logs for foreground commands (start, serve, chat) so the
// user sees the splash / REPL instead of a raw tslog stream. Power users
// can opt back in with `--verbose` (or `-v`) to debug startup issues.
// Logs are still written to ~/.yojin/logs/latest.log regardless.
const command = args[0] ?? 'start';
const verbose = args.includes('--verbose') || args.includes('-v');
const quietCommands = new Set(['start', 'serve', 'chat']);
const consoleStyle = !verbose && quietCommands.has(command) ? 'hidden' : undefined;
const logger = initLogger({ consoleStyle });
logger.info('Yojin starting', { args });
runMain(args).catch((err) => {
  logger.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  console.error('Fatal error:', err);
  process.exit(1);
});
