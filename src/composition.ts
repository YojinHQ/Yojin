/**
 * Composition root — builds the full dependency graph for Yojin.
 *
 * Constructs guards, vault, brain, tools, and agent registry in the
 * correct order. Returns a YojinServices bag that the CLI, gateway,
 * or future AgentRuntime can consume.
 */

import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';

import { JintelClient } from '@yojinhq/jintel-client';
import { z } from 'zod';

import { createDefaultProfiles } from './agents/defaults.js';
import { AgentRegistry } from './agents/registry.js';
import { pubsub } from './api/graphql/pubsub.js';
import { setConnectionManager } from './api/graphql/resolvers/connections.js';
import { runHealthChecks, setDataSourceConfigPath } from './api/graphql/resolvers/data-sources.js';
import { setFetchDeps } from './api/graphql/resolvers/fetch-data-source.js';
import {
  setJintelKeyValidatedCallback,
  setOnboardingConnectionManager,
  setOnboardingDataRoot,
  setOnboardingPersonaManager,
  setOnboardingSnapshotStore,
  setOnboardingVault,
} from './api/graphql/resolvers/onboarding.js';
import { setPortfolioConnectionManager } from './api/graphql/resolvers/portfolio.js';
import { setSignalArchive } from './api/graphql/resolvers/signals.js';
import { setVault } from './api/graphql/resolvers/vault.js';
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
import { createJintelTools } from './jintel/tools.js';
import type { JintelToolOptions } from './jintel/tools.js';
import { getLogger } from './logging/index.js';
import { wireMemory } from './memory/adapter.js';
import type { SignalMemoryStore } from './memory/memory-store.js';
import type { ReflectionEngine } from './memory/reflection.js';
import type { MemoryAgentRole } from './memory/types.js';
import { ensureDataDirs, resolveDataRoot, resolveDefaultsRoot } from './paths.js';
import { PluginRegistry } from './plugins/registry.js';
import { PortfolioSnapshotStore } from './portfolio/snapshot-store.js';
import { createPlatformTools } from './scraper/adapter.js';
import { ConnectionManager } from './scraper/connection-manager.js';
import { loadCredentialLookup } from './scraper/platform-credentials.js';
import { registerAllConnectors } from './scraper/platforms/index.js';
import { SignalArchive } from './signals/archive.js';
import { SignalIngestor } from './signals/ingestor.js';
import { createSignalTools } from './signals/tools.js';
import { createApiHealthTools } from './tools/api-health.js';
import { createBrainTools } from './tools/brain-tools.js';
import { createDataSourceQueryTools } from './tools/data-source-query.js';
import { createDisplayTools } from './tools/display-tools.js';
import { createErrorAnalysisTools } from './tools/error-analysis.js';
import { createPortfolioReasoningTools } from './tools/portfolio-reasoning.js';
import { createPortfolioTools } from './tools/portfolio-tools.js';
import { createSecurityAuditTools } from './tools/security-audit.js';
import { FileAuditLog } from './trust/audit/audit-log.js';
import { ChatPiiScanner } from './trust/pii/chat-scanner.js';
import { DefaultPiiRedactor } from './trust/pii/redactor.js';
import { createSecretTools } from './trust/vault/secure-input.js';
import { EncryptedVault } from './trust/vault/vault.js';
import { wireWatchlist } from './watchlist/adapter.js';

const log = getLogger().sub('composition');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BuildContextOptions {
  /** Data root directory (default: resolveDataRoot()). */
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
  connectionManager?: ConnectionManager;
  pluginRegistry: PluginRegistry;
  dataSourceRegistry: DataSourceRegistry;
  jintelClient?: JintelClient;
  jintelToolOptions: JintelToolOptions;
  personaManager: PersonaManager;
  snapshotStore: PortfolioSnapshotStore;
  piiRedactor: DefaultPiiRedactor;
  piiScanner: ChatPiiScanner;
  memoryStores: Map<MemoryAgentRole, SignalMemoryStore>;
  reflectionEngine?: ReflectionEngine;
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
export async function readPassphraseFromTty(prompt: string): Promise<string> {
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
 * Resolve the vault passphrase from env var only.
 * No TTY prompt at startup — vault auto-unlocks without a passphrase by default.
 * Users can set a passphrase via the web UI or CLI command.
 */
function resolvePassphrase(): string | null {
  return process.env.YOJIN_VAULT_PASSPHRASE ?? null;
}

// ---------------------------------------------------------------------------
// buildContext
// ---------------------------------------------------------------------------

export async function buildContext(options?: BuildContextOptions): Promise<YojinServices> {
  const dataRoot = options?.dataRoot ?? resolveDataRoot();
  await ensureDataDirs(dataRoot);
  const skipVault = options?.skipVault ?? false;

  // 1. Config
  const config = loadConfig();

  // 2. Audit log
  const auditPath = `${dataRoot}/audit`;
  const auditLog = new FileAuditLog(auditPath);

  // 3. Guard pipeline
  const postureName: PostureName = ((config as Record<string, unknown>).guardPosture as PostureName) ?? 'local';
  const posture = POSTURE_CONFIGS[postureName];
  const { guards, outputDlp } = createDefaultGuards(posture, {
    auditPath,
    killSwitch: { sentinelPath: `${dataRoot}/.kill` },
  });
  const guardRunner = new GuardRunner(guards, { auditLog, posture: postureName });
  guardRunner.freeze();

  // 4. Vault (optional)
  let vault: EncryptedVault | undefined;
  if (!skipVault) {
    try {
      vault = new EncryptedVault({ auditLog, vaultPath: `${dataRoot}/vault/secrets.json` });
      // Always expose vault to GraphQL so the web UI can manage it
      setVault(vault);

      const passphrase = resolvePassphrase();
      if (passphrase) {
        await vault.unlock(passphrase);
        log.info('Vault unlocked with passphrase');
      } else {
        // Try auto-unlock with empty passphrase (default for new vaults)
        const autoUnlocked = await vault.tryAutoUnlock();
        if (autoUnlocked) {
          log.info('Vault auto-unlocked (no passphrase set)');
        } else {
          log.info('Vault has a passphrase — unlock via web UI or YOJIN_VAULT_PASSPHRASE env var');
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Vault init failed: ${msg} — credential tools unavailable`);
      vault = undefined;
    }
  }

  // 4b. Portfolio snapshot store (created early — ConnectionManager needs it)
  const snapshotStore = new PortfolioSnapshotStore(dataRoot);

  // 4c. ConnectionManager (requires unlocked vault)
  let connectionManager: ConnectionManager | undefined;
  if (vault?.isUnlocked) {
    const credentialLookup = await loadCredentialLookup(`${dataRoot}/config/platform-credentials.json`);
    connectionManager = new ConnectionManager({
      vault,
      pubsub,
      auditLog,
      configPath: `${dataRoot}/config/connections.json`,
      statePath: `${dataRoot}/cache/connection-state.json`,
      credentialLookup,
      snapshotStore,
    });
    registerAllConnectors({ manager: connectionManager, vault });
    setConnectionManager(connectionManager);
    setPortfolioConnectionManager(connectionManager);
    log.info('ConnectionManager ready');
  }

  // 5. Brain
  const brain = new BrainStore(dataRoot);
  const frontalLobe = new FrontalLobe(brain, dataRoot);
  const emotionTracker = new EmotionTracker(brain, dataRoot);
  const persona = new PersonaManager(dataRoot);

  // 5b. Onboarding resolver injection
  setOnboardingDataRoot(dataRoot);
  setOnboardingPersonaManager(persona);
  setOnboardingSnapshotStore(snapshotStore);
  if (vault) setOnboardingVault(vault);
  if (connectionManager) setOnboardingConnectionManager(connectionManager);

  // 6. DataSourceRegistry (empty — no sources registered yet)
  const dataSourceRegistry = new DataSourceRegistry();

  // 6a. Seed data-sources.json from factory defaults if missing
  const dsConfigPath = `${dataRoot}/config/data-sources.json`;
  if (!existsSync(dsConfigPath)) {
    const defaultDs = `${resolveDefaultsRoot()}/data-sources.default.json`;
    if (existsSync(defaultDs)) {
      await copyFile(defaultDs, dsConfigPath);
      log.info('Seeded data-sources.json from factory defaults');
    }
  }

  // 6b. Signal Archive + Ingestor
  const signalArchive = new SignalArchive({ dir: `${dataRoot}/signals/by-date` });
  const signalIngestor = new SignalIngestor({ archive: signalArchive });
  setSignalArchive(signalArchive);
  setDataSourceConfigPath(dsConfigPath);
  setFetchDeps({ configPath: dsConfigPath, ingestor: signalIngestor, vault });

  // 6c. Run data source health checks (non-blocking)
  runHealthChecks().catch((err) => log.warn('Data source health check failed', { error: String(err) }));

  // 6d. Jintel client (primary intelligence source)
  let jintelClient: JintelClient | undefined;
  if (vault?.isUnlocked) {
    try {
      const jintelApiKey = await vault.get('jintel-api-key');
      if (jintelApiKey) {
        jintelClient = new JintelClient({
          apiKey: jintelApiKey,
          baseUrl: process.env.JINTEL_API_URL,
          debug: process.env.JINTEL_DEBUG === '1',
        });
        log.info('Jintel client ready');
      } else {
        log.warn(
          'Jintel API key not configured — intelligence features disabled. Complete onboarding or add key "jintel-api-key" in Settings → Vault.',
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Jintel client init failed: ${msg}`);
    }
  }

  // 7. ToolRegistry — register all tools
  const toolRegistry = new ToolRegistry();

  // Starter tools (get_current_time, calculate)
  for (const tool of starterTools) {
    toolRegistry.register(tool);
  }

  // Credential tools (4 tools if vault unlocked, stubs if not)
  if (vault?.isUnlocked) {
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

  // Jintel tools (6 tools — always registered; return config error if client unavailable)
  const jintelToolOptions: JintelToolOptions = { client: jintelClient, ingestor: signalIngestor };
  for (const tool of createJintelTools(jintelToolOptions)) {
    toolRegistry.register(tool);
  }

  // Watchlist tools (3 tools: watchlist.add, watchlist.remove, watchlist.list)
  const {
    enrichment: watchlistEnrichment,
    toolOptions: watchlistToolOptions,
    tools: watchlistTools,
  } = await wireWatchlist({
    dataDir: dataRoot,
    jintelClient,
    ttlSeconds: config.watchlist.enrichmentTtlSeconds,
  });
  for (const tool of watchlistTools) {
    toolRegistry.register(tool);
  }

  // Hot-swap Jintel client on key validation.
  setJintelKeyValidatedCallback((apiKey: string) => {
    const newClient = new JintelClient({
      apiKey,
      debug: process.env.JINTEL_DEBUG === '1',
    });
    jintelToolOptions.client = newClient;
    jintelClient = newClient;
    watchlistEnrichment.setJintelClient(newClient);
    watchlistToolOptions.client = newClient;
    log.info('Jintel client hot-swapped after key validation');
  });

  // Signal tools (3 tools: glob_signals, grep_signals, read_signal)
  for (const tool of createSignalTools({ archive: signalArchive })) {
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

  // Data source query tools (2 tools: query_data_source, list_data_sources)
  for (const tool of createDataSourceQueryTools({
    configPath: `${dataRoot}/config/data-sources.json`,
    vault,
    ingestor: signalIngestor,
  })) {
    toolRegistry.register(tool);
  }

  // Portfolio reasoning tool (1 tool)
  for (const tool of createPortfolioReasoningTools({ frontalLobe, emotionTracker })) {
    toolRegistry.register(tool);
  }

  // Portfolio tools (2 tools: save_portfolio_positions, get_portfolio)
  for (const tool of createPortfolioTools({ snapshotStore })) {
    toolRegistry.register(tool);
  }

  // Display tools — trigger rich card rendering on the frontend
  for (const tool of createDisplayTools()) {
    toolRegistry.register(tool);
  }

  // Platform tools (3 tools if ConnectionManager available)
  if (connectionManager) {
    for (const tool of createPlatformTools(connectionManager)) {
      toolRegistry.register(tool);
    }
  }

  const toolCount = toolRegistry.toSchemas().length;
  log.info(`ToolRegistry ready — ${toolCount} tools registered`);

  // 8. AgentRegistry
  const agentRegistry = new AgentRegistry();
  for (const profile of createDefaultProfiles()) {
    agentRegistry.register(profile);
  }
  log.info(`AgentRegistry ready — ${agentRegistry.getAll().length} agents`);

  // 9. PII redaction
  const piiRedactor = new DefaultPiiRedactor({ auditLog });
  const piiScanner = new ChatPiiScanner({
    auditLog,
    enableNer: process.env.YOJIN_PII_NER === '1',
  });

  // --- Signal memory ---
  // ReflectionEngine requires providerRouter + priceProvider, which are created
  // after buildContext (in run-main.ts). Use createReflectionEngine() to late-wire.
  const memoryResult = await wireMemory({
    dataRoot,
    piiRedactor,
  });
  for (const tool of memoryResult.tools) {
    toolRegistry.register(tool);
  }

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
    connectionManager,
    pluginRegistry,
    dataSourceRegistry,
    jintelClient,
    jintelToolOptions,
    personaManager: persona,
    snapshotStore,
    piiRedactor,
    piiScanner,
    memoryStores: memoryResult.stores,
    reflectionEngine: memoryResult.reflectionEngine,
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
  'Vault is locked — no passphrase provided. Set YOJIN_VAULT_PASSPHRASE or run in a TTY to unlock.';

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
