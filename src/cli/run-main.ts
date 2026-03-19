/**
 * CLI main runner.
 */

import { spawn } from 'node:child_process';
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
    // --- User-facing commands ---
    case 'start':
    case 'serve':
      await startGateway();
      break;
    case 'chat':
      await startChat(args.slice(1));
      break;
    case 'setup':
    case 'setup-token':
      await setupToken(args.slice(1));
      break;
    case 'web':
      await startFrontend();
      break;
    case 'secret':
      await runSecretCommand(args.slice(1));
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

function startFrontend(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['--filter', '@yojin/web', 'dev'], {
      stdio: 'inherit',
      shell: true,
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Frontend exited with code ${code}`))));
    child.on('error', reject);
  });
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
Yojin — Your personal AI finance agent

Commands:
  yojin                Start Yojin (server + dashboard)
  yojin chat [options] Chat with Yojin in your terminal
    --model <model>      Model to use (default: claude-opus-4-6)
    --provider <id>      Provider to use (default: anthropic)
    --system <prompt>    System prompt
  yojin setup          Connect your Claude account

Advanced:
  yojin serve          Alias for start
  yojin web            Start the dashboard only
  yojin secret <cmd>   Manage stored credentials
  yojin acp            Start ACP (Agent Client Protocol) server
  yojin version        Print version
  yojin help           Show this message
`);
}
