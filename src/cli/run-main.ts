/**
 * CLI main runner.
 */

import { startChat } from './chat.js';
import { setupToken } from './setup-token.js';
import { createDefaultProfiles } from '../agents/defaults.js';
import { AgentRegistry } from '../agents/registry.js';
import { ClaudeCodeProvider } from '../ai-providers/claude-code.js';
import { ProviderRouter } from '../ai-providers/router.js';
import { VercelAIProvider } from '../ai-providers/vercel-ai.js';
import { loadConfig } from '../config/config.js';
import { AgentRuntime } from '../core/agent-runtime.js';
import { EventLog } from '../core/event-log.js';
import { starterTools } from '../core/starter-tools.js';
import { ToolRegistry } from '../core/tool-registry.js';
import { Gateway } from '../gateway/server.js';
import { GuardRunner } from '../guards/guard-runner.js';
import { getPostureConfig } from '../guards/posture.js';
import { createDefaultGuards } from '../guards/registry.js';
import { JsonlSessionStore } from '../sessions/jsonl-store.js';
import { FileAuditLog } from '../trust/audit/audit-log.js';
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

  // --- Composition root: wire AgentRuntime ---
  const dataRoot = '.';
  const auditLog = new FileAuditLog(`${dataRoot}/data/audit`);
  const toolRegistry = new ToolRegistry();
  for (const tool of starterTools) {
    toolRegistry.register(tool);
  }

  const agentRegistry = new AgentRegistry();
  for (const profile of createDefaultProfiles()) {
    agentRegistry.register(profile);
  }

  const providerRouter = new ProviderRouter();
  providerRouter.registerBackend(new ClaudeCodeProvider());
  providerRouter.registerBackend(new VercelAIProvider());
  await providerRouter.loadConfig();
  providerRouter.startConfigRefresh();

  const posture = getPostureConfig('local');
  const { guards, outputDlp } = createDefaultGuards(posture);
  const guardRunner = new GuardRunner(guards, { auditLog, posture: 'local' });
  guardRunner.freeze();

  const agentRuntime = new AgentRuntime({
    agentRegistry,
    toolRegistry,
    guardRunner,
    sessionStore: new JsonlSessionStore(`${dataRoot}/data/sessions`),
    eventLog: new EventLog(`${dataRoot}/data/event-log`),
    provider: providerRouter,
    outputDlp,
    dataRoot,
  });

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
  yojin version                      Print version
  yojin help                         Show this help message
`);
}
