/**
 * Yojin entry point.
 */

import { runMain } from './cli/run-main.js';
import { initLogger } from './logging/index.js';

const args = process.argv.slice(2);

// Hide console logs during interactive chat so they don't interfere
const isChat = args[0] === 'chat';
const logger = initLogger({ consoleStyle: isChat ? 'hidden' : undefined });
logger.info('Yojin starting', { args });
runMain(args).catch((err) => {
  logger.error('Fatal error', { error: err instanceof Error ? err.message : String(err) });
  console.error('Fatal error:', err);
  process.exit(1);
});
