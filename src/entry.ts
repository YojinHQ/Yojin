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
    console.warn('[uncaughtException] Ignored ReadableStream close race (Node <22.12 bug)');
    return;
  }
  console.error('[uncaughtException]', err);
  process.exit(1);
});

// Hide console logs during interactive chat so they don't interfere
const isChat = args[0] === 'chat';
const logger = initLogger({ consoleStyle: isChat ? 'hidden' : undefined });
logger.info('Yojin starting', { args });
runMain(args).catch((err) => {
  logger.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  console.error('Fatal error:', err);
  process.exit(1);
});
