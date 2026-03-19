/**
 * CLI main runner.
 */

import { createRequire } from 'node:module';

import { startChat } from './chat.js';
import { setupToken } from './setup-token.js';
import { LocalRuntimeBridge } from '../acp/runtime-bridge.js';
import { startAcpServer } from '../acp/server.js';
import { AcpSessionStore } from '../acp/session-store.js';
import { ClaudeCodeProvider } from '../ai-providers/claude-code.js';
import { ProviderRouter } from '../ai-providers/router.js';
import { VercelAIProvider } from '../ai-providers/vercel-ai.js';
import { buildContext } from '../composition.js';
import { AgentRuntime } from '../core/agent-runtime.js';
import { EventLog } from '../core/event-log.js';
import { Gateway } from '../gateway/server.js';
import { JsonlSessionStore } from '../sessions/jsonl-store.js';
import { runSecretCommand } from '../trust/vault/cli.js';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../../package.json') as { version: string };

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
    case 'acp':
      await startAcp();
      break;
    case 'version':
      console.log(`yojin v${PKG_VERSION}`);
      break;
    case 'help':
    default:
      printHelp();
      break;
  }
}

/**
 * Build a fully-wired AgentRuntime using the same composition root as `pnpm chat`.
 *
 * This gives gateway, ACP, and any future entry point the full tool set,
 * brain integration, vault, guards, and PII scanner.
 */
async function buildFullRuntime(): Promise<{ agentRuntime: AgentRuntime; dataRoot: string }> {
  const dataRoot = '.';
  const services = await buildContext({ dataRoot });

  const providerRouter = new ProviderRouter();
  providerRouter.registerBackend(new ClaudeCodeProvider());
  providerRouter.registerBackend(new VercelAIProvider());
  await providerRouter.loadConfig();
  providerRouter.startConfigRefresh();

  const agentRuntime = new AgentRuntime({
    agentRegistry: services.agentRegistry,
    toolRegistry: services.toolRegistry,
    guardRunner: services.guardRunner,
    sessionStore: new JsonlSessionStore(`${dataRoot}/data/sessions`),
    eventLog: new EventLog(`${dataRoot}/data/event-log`),
    provider: providerRouter,
    outputDlp: services.outputDlp,
    piiScanner: services.piiScanner,
    brain: services.brain,
    dataRoot,
  });

  return { agentRuntime, dataRoot };
}

async function startGateway(): Promise<void> {
  const { agentRuntime } = await buildFullRuntime();
  const { loadConfig } = await import('../config/config.js');
  const config = loadConfig();

  const gateway = new Gateway(config, agentRuntime);

  // Graceful shutdown
  const shutdown = async () => {
    await gateway.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await gateway.start();
}

async function startAcp(): Promise<void> {
  const { agentRuntime, dataRoot } = await buildFullRuntime();
  const bridge = new LocalRuntimeBridge(agentRuntime);
  const acpSessionStore = new AcpSessionStore(`${dataRoot}/data/acp`);
  const { shutdown } = startAcpServer({ bridge, sessionStore: acpSessionStore });

  const gracefulShutdown = async () => {
    await shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void gracefulShutdown());
  process.on('SIGTERM', () => void gracefulShutdown());
}

function printHelp(): void {
  console.log(`
yojin — Multi-LLM, multi-channel AI agent platform

Usage:
  yojin start                        Start the gateway server (default)
  yojin chat [options]               Interactive terminal chat
    --model <model>                    Model to use (default: claude-opus-4-6)
    --provider <id>                    Provider to use (default: anthropic)
    --system <prompt>                  System prompt
  yojin secret set <key>             Store a secret (hidden TTY input)
  yojin secret show <key>            Reveal a secret (TTY + confirmation)
  yojin secret list                  List secret names (never values)
  yojin secret delete <key>          Delete a secret
  yojin setup-token [--method M]     Acquire a Claude OAuth token
                                     Methods: oauth, cli, paste
  yojin acp                          Start ACP (Agent Client Protocol) server
  yojin version                      Print version
  yojin help                         Show this help message
`);
}
