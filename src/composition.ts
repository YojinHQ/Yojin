/**
 * Composition root — builds the full dependency graph for Yojin.
 *
 * Constructs guards, vault, brain, tools, and agent registry in the
 * correct order. Returns a YojinServices bag that the CLI, gateway,
 * or future AgentRuntime can consume.
 */

import { z } from 'zod';

import { createDefaultProfiles } from './agents/defaults.js';
import { AgentRegistry } from './agents/registry.js';
import { BrainStore } from './brain/brain.js';
import { EmotionTracker } from './brain/emotion.js';
import { FrontalLobe } from './brain/frontal-lobe.js';
import { PersonaManager } from './brain/persona.js';
import type { YojinConfig } from './config/config.js';
import { loadConfig } from './config/config.js';
import { starterTools } from './core/starter-tools.js';
import { ToolRegistry } from './core/tool-registry.js';
import type { ToolDefinition, ToolResult } from './core/types.js';
import { DataSourceRegistry } from './data-sources/registry.js';
import { GuardRunner } from './guards/guard-runner.js';
import { POSTURE_CONFIGS } from './guards/posture.js';
import { createDefaultGuards } from './guards/registry.js';
import type { OutputDlpGuard } from './guards/security/output-dlp.js';
import type { PostureName } from './guards/types.js';
import { getLogger } from './logging/index.js';
import { PluginRegistry } from './plugins/registry.js';
import { createApiHealthTools } from './tools/api-health.js';
import { createBrainTools } from './tools/brain-tools.js';
import { createErrorAnalysisTools } from './tools/error-analysis.js';
import { createPortfolioReasoningTools } from './tools/portfolio-reasoning.js';
import { createSecurityAuditTools } from './tools/security-audit.js';
import { FileAuditLog } from './trust/audit/audit-log.js';
import { ChatPiiScanner } from './trust/pii/chat-scanner.js';
import { createSecretTools } from './trust/vault/secure-input.js';
import { EncryptedVault } from './trust/vault/vault.js';

const log = getLogger().sub('composition');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BuildContextOptions {
  /** Data root directory (default: '.'). */
  dataRoot?: string;
  /** Skip vault initialization (for tests). */
  skipVault?: boolean;
}

export interface YojinServices {
  config: YojinConfig;
  toolRegistry: ToolRegistry;
  agentRegistry: AgentRegistry;
  guardRunner: GuardRunner;
  outputDlp: OutputDlpGuard;
  auditLog: FileAuditLog;
  vault?: EncryptedVault;
  pluginRegistry: PluginRegistry;
  dataSourceRegistry: DataSourceRegistry;
  personaManager: PersonaManager;
  piiScanner: ChatPiiScanner;
  brain: {
    persona: PersonaManager;
    frontalLobe: FrontalLobe;
    emotion: EmotionTracker;
  };
}

// ---------------------------------------------------------------------------
// Vault passphrase resolution
// ---------------------------------------------------------------------------

/**
 * Read a passphrase from TTY with echo disabled.
 * Prompts on stderr so the LLM (reading stdout) never sees it.
 */
async function readPassphraseFromTty(prompt: string): Promise<string> {
  process.stderr.write(prompt);

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const wasEncoding = (stdin as NodeJS.ReadStream & { readableEncoding?: BufferEncoding | null }).readableEncoding;
    let input = '';

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const cleanup = (): void => {
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener('data', onData);
      if (wasEncoding) stdin.setEncoding(wasEncoding);
      process.stderr.write('\n');
    };

    const onData = (char: string): void => {
      const code = char.charCodeAt(0);

      if (char === '\r' || char === '\n') {
        cleanup();
        resolve(input);
      } else if (code === 3) {
        cleanup();
        // Re-raise SIGINT so the process exits as the user expects
        process.kill(process.pid, 'SIGINT');
        reject(new Error('Cancelled by user'));
      } else if (code === 127 || code === 8) {
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else if (code >= 32) {
        input += char;
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Resolve the vault passphrase:
 * 1. YOJIN_VAULT_PASSPHRASE env var
 * 2. TTY prompt (if stdin is a TTY)
 * 3. null (vault skipped)
 */
async function resolvePassphrase(): Promise<string | null> {
  const envPassphrase = process.env.YOJIN_VAULT_PASSPHRASE;
  if (envPassphrase) return envPassphrase;

  if (process.stdin.isTTY) {
    try {
      return await readPassphraseFromTty('Vault passphrase (hidden): ');
    } catch {
      return null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// buildContext
// ---------------------------------------------------------------------------

export async function buildContext(options?: BuildContextOptions): Promise<YojinServices> {
  const dataRoot = options?.dataRoot ?? '.';
  const skipVault = options?.skipVault ?? false;

  // 1. Config
  const config = loadConfig();

  // 2. Audit log
  const auditLog = new FileAuditLog(`${dataRoot}/data/audit`);

  // 3. Guard pipeline
  const postureName: PostureName = ((config as Record<string, unknown>).guardPosture as PostureName) ?? 'local';
  const posture = POSTURE_CONFIGS[postureName];
  const { guards, outputDlp } = createDefaultGuards(posture);
  const guardRunner = new GuardRunner(guards, { auditLog, posture: postureName });
  guardRunner.freeze();

  // 4. Vault (optional)
  let vault: EncryptedVault | undefined;
  if (!skipVault) {
    try {
      vault = new EncryptedVault({ auditLog, vaultPath: `${dataRoot}/data/vault/secrets.json` });
      const passphrase = await resolvePassphrase();
      if (passphrase) {
        await vault.unlock(passphrase);
        log.info('Vault unlocked');
      } else {
        log.info('No vault passphrase — credential tools will report vault locked');
        vault = undefined;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Vault init failed: ${msg} — credential tools unavailable`);
      vault = undefined;
    }
  }

  // 5. Brain
  const brain = new BrainStore(dataRoot);
  const frontalLobe = new FrontalLobe(brain, dataRoot);
  const emotionTracker = new EmotionTracker(brain, dataRoot);
  const persona = new PersonaManager(dataRoot);

  // 6. DataSourceRegistry (empty — no sources registered yet)
  const dataSourceRegistry = new DataSourceRegistry();

  // 7. ToolRegistry — register all tools
  const toolRegistry = new ToolRegistry();

  // Starter tools (get_current_time, calculate)
  for (const tool of starterTools) {
    toolRegistry.register(tool);
  }

  // Credential tools (4 tools if vault available, stubs if not)
  if (vault) {
    for (const tool of createSecretTools({ vault })) {
      toolRegistry.register(tool);
    }
  } else {
    for (const tool of createVaultLockedStubs()) {
      toolRegistry.register(tool);
    }
  }

  // Brain tools (7 tools)
  for (const tool of createBrainTools({ brain, frontalLobe, emotionTracker, persona })) {
    toolRegistry.register(tool);
  }

  // Security audit tool (1 tool)
  for (const tool of createSecurityAuditTools({ guardRunner })) {
    toolRegistry.register(tool);
  }

  // Error analysis tool (1 tool)
  for (const tool of createErrorAnalysisTools({ dataSourceRegistry })) {
    toolRegistry.register(tool);
  }

  // API health tool (1 tool)
  for (const tool of createApiHealthTools({ dataSourceRegistry })) {
    toolRegistry.register(tool);
  }

  // Portfolio reasoning tool (1 tool)
  for (const tool of createPortfolioReasoningTools({ frontalLobe, emotionTracker })) {
    toolRegistry.register(tool);
  }

  const toolCount = toolRegistry.toSchemas().length;
  log.info(`ToolRegistry ready — ${toolCount} tools registered`);

  // 8. AgentRegistry
  const agentRegistry = new AgentRegistry();
  for (const profile of createDefaultProfiles()) {
    agentRegistry.register(profile);
  }
  log.info(`AgentRegistry ready — ${agentRegistry.getAll().length} agents`);

  // 9. PII scanner (regex-only by default, NER opt-in via YOJIN_PII_NER=1)
  const piiScanner = new ChatPiiScanner({
    auditLog,
    enableNer: process.env.YOJIN_PII_NER === '1',
  });

  // 10. PluginRegistry (empty — caller loads provider/channel plugins)
  const pluginRegistry = new PluginRegistry();

  return {
    config,
    toolRegistry,
    agentRegistry,
    guardRunner,
    outputDlp,
    auditLog,
    vault,
    pluginRegistry,
    dataSourceRegistry,
    personaManager: persona,
    piiScanner,
    brain: {
      persona,
      frontalLobe,
      emotion: emotionTracker,
    },
  };
}

// ---------------------------------------------------------------------------
// Vault-locked stubs — registered when vault is unavailable
// ---------------------------------------------------------------------------

const VAULT_LOCKED_MSG =
  'Vault is locked — no passphrase provided. ' + 'Set YOJIN_VAULT_PASSPHRASE or run in a TTY to unlock.';

function createVaultLockedStubs(): ToolDefinition[] {
  return [
    {
      name: 'store_credential',
      description:
        'Securely collect and store a credential from the user. ' +
        'The value is entered directly by the user in the terminal (hidden input) ' +
        'and stored in the encrypted vault. The actual value is NEVER returned to you.',
      parameters: z.object({
        key: z.string(),
        description: z.string(),
      }),
      async execute(): Promise<ToolResult> {
        return { content: VAULT_LOCKED_MSG, isError: true };
      },
    },
    {
      name: 'check_credential',
      description: 'Check if a named credential exists in the vault. Returns true/false, never the value.',
      parameters: z.object({ key: z.string() }),
      async execute(): Promise<ToolResult> {
        return { content: VAULT_LOCKED_MSG, isError: true };
      },
    },
    {
      name: 'list_credentials',
      description: 'List all stored credential names. Never returns values.',
      parameters: z.object({}),
      async execute(): Promise<ToolResult> {
        return { content: VAULT_LOCKED_MSG, isError: true };
      },
    },
    {
      name: 'delete_credential',
      description: 'Delete a credential from the vault.',
      parameters: z.object({ key: z.string() }),
      async execute(): Promise<ToolResult> {
        return { content: VAULT_LOCKED_MSG, isError: true };
      },
    },
  ];
}
