/**
 * CLI main runner.
 */

import { startChat } from './chat.js';
import { setupToken } from './setup-token.js';
import { loadConfig } from '../config/config.js';
import { Gateway } from '../gateway/server.js';
import { runSecretCommand } from '../trust/vault/cli.js';

export async function runMain(args: string[]): Promise<void> {
  const command = args[0] ?? 'start';

  switch (command) {
    case 'start':
      await startGateway();
      break;
    case 'chat':
      await startChat(args.slice(1));
      break;
    case 'secret':
      await runSecretCommand(args.slice(1));
      break;
    case 'setup-token':
      await setupToken(args.slice(1));
      break;
    case 'version':
      console.log('yojin v0.1.0');
      break;
    case 'help':
    default:
      printHelp();
      break;
  }
}

async function startGateway(): Promise<void> {
  const config = loadConfig();
  const gateway = new Gateway(config);

  // Graceful shutdown
  const shutdown = async () => {
    await gateway.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await gateway.start();
}

function printHelp(): void {
  console.log(`
yojin — Multi-LLM, multi-channel AI agent platform

Usage:
  yojin start                        Start the gateway server (default)
  yojin chat [options]               Interactive terminal chat
    --model <model>                    Model to use (default: claude-sonnet-4-20250514)
    --provider <id>                    Provider to use (default: anthropic)
    --system <prompt>                  System prompt
  yojin secret set <key>             Store a secret (hidden TTY input)
  yojin secret show <key>            Reveal a secret (TTY + confirmation)
  yojin secret list                  List secret names (never values)
  yojin secret delete <key>          Delete a secret
  yojin setup-token [--method M]     Acquire a Claude OAuth token
                                     Methods: oauth, cli, paste
  yojin version                      Print version
  yojin help                         Show this help message
`);
}
