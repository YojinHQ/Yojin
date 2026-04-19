/**
 * CLI main runner.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { startChat } from './chat.js';
import { setupToken } from './setup-token.js';
import { onShutdownSignal } from './shutdown-signals.js';
import { runStrategyDebug } from './strategy-debug.js';
import { createSlackPlugin } from '../../channels/slack/index.js';
import { createTelegramPlugin } from '../../channels/telegram/index.js';
import { createWhatsAppPlugin } from '../../channels/whatsapp/index.js';
import { LocalRuntimeBridge } from '../acp/runtime-bridge.js';
import { startAcpServer } from '../acp/server.js';
import { AcpSessionStore } from '../acp/session-store.js';
import { Orchestrator, registerBuiltinWorkflows, setWorkflowProgressCallback } from '../agents/index.js';
import { ClaudeCodeProvider } from '../ai-providers/claude-code.js';
import { CodexProvider } from '../ai-providers/codex.js';
import { ProviderRouter } from '../ai-providers/router.js';
import { setEventLog } from '../api/graphql/resolvers/activity-log.js';
import { setAiConfigClaudeCodeProvider, setAiConfigProviderRouter } from '../api/graphql/resolvers/ai-config.js';
import { setChannelRegistry } from '../api/graphql/resolvers/channels.js';
import { setCurationOrchestrator, setCurationPipelineDeps } from '../api/graphql/resolvers/curated-signals.js';
import { setDeepAnalysisDeps } from '../api/graphql/resolvers/deep-analysis.js';
import { setInsightsOrchestrator } from '../api/graphql/resolvers/insights.js';
import { setMicroInsightStore } from '../api/graphql/resolvers/micro-insights.js';
import {
  setMicroLlmIntervalCallback,
  setOnboardingClaudeCodeProvider,
  setOnboardingProvider,
} from '../api/graphql/resolvers/onboarding.js';
import { setPortfolioChangedCallback } from '../api/graphql/resolvers/portfolio.js';
import { onAppDataCleared } from '../api/graphql/resolvers/profile.js';
import {
  setClearSchedulerLlmError,
  setSchedulerStatusProvider,
  setTriggerMicroAnalysis,
  setTriggerStrategyEvaluation,
} from '../api/graphql/resolvers/scheduler.js';
import { setStrategySuggestionDeps } from '../api/graphql/resolvers/strategies.js';
import { setWatchlistChangedCallback } from '../api/graphql/resolvers/watchlist.js';
import { buildContext } from '../composition.js';
import { AgentRuntime } from '../core/agent-runtime.js';
import { EventLog } from '../core/event-log.js';
import { NotificationBus } from '../core/notification-bus.js';
import { Gateway } from '../gateway/server.js';
import { MicroInsightStore } from '../insights/micro-insight-store.js';
import { createJintelPriceProvider } from '../jintel/price-provider.js';
import { MarketSentimentBaselineStore } from '../market-sentiment/baseline-store.js';
import { createReflectionEngine } from '../memory/adapter.js';
import { resolveDataRoot, resolvePackageRoot, resolvePackageVersion } from '../paths.js';
import { Scheduler } from '../scheduler.js';
import { JsonlSessionStore } from '../sessions/jsonl-store.js';
import { SignalClustering } from '../signals/clustering.js';
import { AssessmentConfigSchema } from '../signals/curation/assessment-types.js';
import { registerFullCurationWorkflow } from '../signals/curation/full-curation-workflow.js';
import { CurationConfigSchema } from '../signals/curation/types.js';
import { QualityAgent } from '../signals/quality-agent.js';
import { runSecretCommand } from '../trust/vault/cli.js';

const PKG_VERSION = resolvePackageVersion();

export async function runMain(args: string[]): Promise<void> {
  // `--port <n>` overrides YOJIN_PORT for the current run. We propagate via
  // the env var so the rest of the config pipeline (loadConfig → channels[web]
  // → web channel setupAdapter) picks it up with no extra wiring.
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1) {
    const raw = args[portIdx + 1];
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      console.error(`Invalid --port value: "${raw ?? ''}". Must be an integer between 1 and 65535.`);
      process.exit(1);
    }
    process.env.YOJIN_PORT = String(port);
  }

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
    case 'insights':
      await runInsights();
      break;
    case 'eval-strategies':
      await runStrategyDebug(args.slice(1));
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
async function buildFullRuntime(): Promise<{
  agentRuntime: AgentRuntime;
  dataRoot: string;
  eventLog: EventLog;
  services: Awaited<ReturnType<typeof buildContext>>;
  sessionStore: JsonlSessionStore;
  providerRouter: ProviderRouter;
}> {
  const dataRoot = resolveDataRoot();
  const services = await buildContext({ dataRoot });

  const providerRouter = new ProviderRouter({ configPath: `${dataRoot}/config/ai-provider.json` });
  const claudeProvider = new ClaudeCodeProvider();
  await claudeProvider.initialize();
  providerRouter.registerBackend(claudeProvider);
  providerRouter.registerBackend(new CodexProvider());
  await providerRouter.loadConfig();
  providerRouter.startConfigRefresh();
  setOnboardingProvider(providerRouter);
  setOnboardingClaudeCodeProvider(claudeProvider);
  setAiConfigProviderRouter(providerRouter);
  setAiConfigClaudeCodeProvider(claudeProvider);

  // Wire signal quality pipeline — single QualityAgent handles enrichment, dedup, and quality gating.
  const llmComplete = async (prompt: string): Promise<string> => {
    const result = await providerRouter.completeWithTools({
      model: 'haiku',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 512,
    });
    const text = result.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return text;
  };

  const qualityAgent = new QualityAgent({ complete: llmComplete });

  const clustering = new SignalClustering({
    archive: services.signalArchive,
    groupArchive: services.signalGroupArchive,
    qualityAgent,
    concurrencyLimit: 5,
  });
  services.signalIngestor.setClustering(clustering);
  services.signalIngestor.setQualityAgent(qualityAgent);

  // ReflectionEngine with lazy price provider — reads jintelToolOptions.client at call time.
  const priceProvider = createJintelPriceProvider({
    getClient: () => services.jintelToolOptions.client,
  });
  services.reflectionEngine = createReflectionEngine({
    stores: services.memoryStores,
    providerRouter,
    priceProvider,
    piiRedactor: services.piiRedactor,
    onReflected: async (entry, grade, lesson, actualReturn) => {
      const { buildLessonEntry } = await import('../profiles/profile-bridge.js');
      for (const ticker of entry.tickers) {
        const lessonEntry = buildLessonEntry(ticker, lesson, grade, actualReturn, entry.id, entry.createdAt);
        await services.profileStore.store(lessonEntry);
      }
    },
  });

  const sessionStore = new JsonlSessionStore(`${dataRoot}/sessions`);

  const eventLog = new EventLog(`${dataRoot}/event-log`);
  setEventLog(eventLog);

  const agentRuntime = new AgentRuntime({
    agentRegistry: services.agentRegistry,
    toolRegistry: services.toolRegistry,
    guardRunner: services.guardRunner,
    sessionStore,
    eventLog,
    provider: providerRouter,
    outputDlp: services.outputDlp,
    piiScanner: services.piiScanner,
    brain: services.brain,
    dataRoot,
  });

  return { agentRuntime, dataRoot, eventLog, services, sessionStore, providerRouter };
}

async function startGateway(): Promise<void> {
  const { agentRuntime, dataRoot, eventLog, services, sessionStore, providerRouter } = await buildFullRuntime();

  // Micro insight store — per-ticker JSONL for micro research outputs
  const microInsightStore = new MicroInsightStore(dataRoot);
  setMicroInsightStore(microInsightStore);

  // Wire the orchestrator for ProcessInsights mutation
  const orchestrator = new Orchestrator(agentRuntime);
  registerBuiltinWorkflows(orchestrator, {
    reflectionEngine: services.reflectionEngine,
    insightStore: services.insightStore,
    memoryStore: services.memoryStores.get('analyst'),
    snapStore: services.snapStore,
    profileStore: services.profileStore,
    gathererOptions: {
      snapshotStore: services.snapshotStore,
      signalArchive: services.signalArchive,
      insightStore: services.insightStore,
      getJintelClient: () => services.jintelToolOptions.client,
      memoryStores: services.memoryStores,
      profileStore: services.profileStore,
    },
    macroGathererOptions: {
      microInsightStore,
      snapshotStore: services.snapshotStore,
      fallbackGathererOptions: {
        snapshotStore: services.snapshotStore,
        signalArchive: services.signalArchive,
        insightStore: services.insightStore,
        getJintelClient: () => services.jintelToolOptions.client,
        memoryStores: services.memoryStores,
        profileStore: services.profileStore,
      },
    },
  });
  setInsightsOrchestrator(orchestrator);

  // Wire deep analysis (on-demand single-position deep dive)
  setDeepAnalysisDeps({
    insightStore: services.insightStore,
    providerRouter,
    signalArchive: services.signalArchive,
    gathererOptions: {
      snapshotStore: services.snapshotStore,
      signalArchive: services.signalArchive,
      insightStore: services.insightStore,
      getJintelClient: () => services.jintelToolOptions.client,
      memoryStores: services.memoryStores,
      profileStore: services.profileStore,
    },
  });

  // Wire LLM-powered ticker suggester for strategy activation modal
  const { TickerSuggester } = await import('../strategies/ticker-suggester.js');
  setStrategySuggestionDeps({
    tickerSuggester: new TickerSuggester(providerRouter),
    snapshotStore: services.snapshotStore,
    watchlistStore: services.watchlistStore,
    jintelClient: services.jintelToolOptions.client,
  });

  // Register full-curation workflow (Tier 1 + Tier 2) for the UI button
  const { loadJsonConfig, AlertsConfigSchema } = await import('../config/config.js');
  const alertsConfigRaw = await loadJsonConfig(`${dataRoot}/config/alerts.json`, AlertsConfigSchema);
  const alertsConfig = AlertsConfigSchema.parse(alertsConfigRaw);
  const curationConfigRaw = await loadJsonConfig(`${dataRoot}/config/curation.json`, CurationConfigSchema);
  const curationConfig = CurationConfigSchema.parse(curationConfigRaw);
  const assessmentConfigRaw = await loadJsonConfig(`${dataRoot}/config/assessment.json`, AssessmentConfigSchema);
  const assessmentConfig = AssessmentConfigSchema.parse(assessmentConfigRaw);

  // Log ingestion events — scheduler.triggerMicroFlow wired below after scheduler construction.
  services.signalIngestor.setPostIngestHook(async (tickers, ingested) => {
    if (ingested === 0) return;
    await eventLog.append({
      type: 'system',
      data: { message: `Ingested ${ingested} new signal${ingested !== 1 ? 's' : ''}` },
    });
  });

  registerFullCurationWorkflow(orchestrator, {
    signalArchive: services.signalArchive,
    assessmentStore: services.assessmentStore,
    insightStore: services.insightStore,
    snapshotStore: services.snapshotStore,
    assessmentConfig,
    assessmentWorkflowStartMs: services.assessmentWorkflowStartMs,
  });
  setCurationOrchestrator(orchestrator);
  setCurationPipelineDeps({ archive: services.signalArchive, config: curationConfig });

  // Broadcast workflow progress events to GraphQL subscribers + persist to log file
  const { pubsub } = await import('../api/graphql/pubsub.js');
  const { WorkflowLog } = await import('../insights/workflow-log.js');
  const workflowLog = new WorkflowLog(dataRoot);
  let writeQueue = Promise.resolve();
  setWorkflowProgressCallback((event) => {
    pubsub.publish('workflowProgress', event);
    writeQueue = writeQueue.then(() => workflowLog.write(event));
  });

  const notificationBus = new NotificationBus();

  const channelDeps = {
    notificationBus,
    snapStore: services.snapStore,
    insightStore: services.insightStore,
    actionStore: services.actionStore,
  };

  const slackPlugin = createSlackPlugin(channelDeps);
  const telegramPlugin = createTelegramPlugin({ vault: services.vault, ...channelDeps });
  const whatsAppPlugin = createWhatsAppPlugin({
    oauthDir: join(dataRoot, 'oauth'),
    piiRedactor: services.piiRedactor,
    ...channelDeps,
  });

  // Market sentiment baseline — accumulates index ETF sentiment for future regime detection
  const marketSentimentBaseline = new MarketSentimentBaselineStore(dataRoot);
  marketSentimentBaseline.initialize();

  // Daily insights scheduler — reads digestSchedule from alerts.json
  const scheduler = new Scheduler({
    orchestrator,
    dataRoot,
    reflectionEngine: services.reflectionEngine,
    strategyEvaluator: services.strategyEvaluator,
    summaryStore: services.summaryStore,
    actionStore: services.actionStore,
    alertStore: services.alertStore,
    snapshotStore: services.snapshotStore,
    snapStore: services.snapStore,
    insightStore: services.insightStore,
    eventLog,
    getJintelClient: () => services.jintelToolOptions.client,
    signalIngestor: services.signalIngestor,
    notificationBus,
    marketSentimentBaseline,
    // Micro research deps
    providerRouter,
    microInsightStore,
    watchlistStore: services.watchlistStore,
    memoryStores: services.memoryStores,
    profileStore: services.profileStore,
    signalArchive: services.signalArchive,
    microLlmIntervalMs: alertsConfig.microLlmIntervalHours
      ? alertsConfig.microLlmIntervalHours * 60 * 60 * 1000
      : undefined,
    alertPromoterConfig: {
      ...(alertsConfig.alertSeverityThreshold !== undefined && {
        severityThreshold: alertsConfig.alertSeverityThreshold,
      }),
      ...(alertsConfig.alertCooldownHours !== undefined && {
        cooldownMs: alertsConfig.alertCooldownHours * 60 * 60 * 1000,
      }),
    },
  });
  scheduler.start();

  // Reset scheduler in-memory state when user clears app data — prevents stale
  // micro registry tickers from regenerating snap/actions immediately after wipe.
  onAppDataCleared(() => scheduler.reset());

  // Trigger micro flow when portfolio changes — fetches intel for the changed tickers only
  setPortfolioChangedCallback((tickers) => scheduler.triggerMicroFlow(tickers));
  // Trigger micro flow when watchlist changes
  setWatchlistChangedCallback((tickers) => scheduler.triggerMicroFlow(tickers, 'watchlist'));
  // Re-wire post-ingest hook now that scheduler is available: immediately trigger micro research
  // for assets with new signals instead of waiting for the next 30s tick.
  services.signalIngestor.setPostIngestHook(async (tickers, ingested) => {
    if (ingested === 0) return;
    await eventLog.append({
      type: 'system',
      data: { message: `Ingested ${ingested} new signal${ingested !== 1 ? 's' : ''}` },
    });
    if (tickers.length > 0) {
      scheduler.triggerMicroFlow(tickers);
      await services.watchlistEnrichment.invalidateTickers(tickers);
    }
  });
  // Apply micro LLM interval changes from UI settings immediately (no restart needed)
  setMicroLlmIntervalCallback((hours) => scheduler.setMicroLlmIntervalMs(hours * 60 * 60 * 1000));
  // Expose scheduler status to the schedulerStatus GraphQL query
  setSchedulerStatusProvider(() => scheduler.getStatus());
  // Allow the UI to force-run micro analysis for throttled assets immediately
  setTriggerMicroAnalysis(() => {
    const throttled = scheduler.getStatus().assets.filter((a) => a.pendingAnalysis);
    if (throttled.length > 0) {
      scheduler.triggerMicroFlow(throttled.map((a) => a.symbol));
    }
  });
  setTriggerStrategyEvaluation(() => scheduler.evaluateStrategies());
  // Let credential resolvers clear the "AI analysis paused" banner immediately
  // when a token re-validates, instead of waiting for the next scheduled run.
  setClearSchedulerLlmError(() => scheduler.clearLlmError());

  const gateway = new Gateway(services.config, agentRuntime, {
    snapshotStore: services.snapshotStore,
    connectionManager: services.connectionManager,
    sessionStore,
    extraPlugins: [slackPlugin, telegramPlugin, whatsAppPlugin],
  });

  // Graceful shutdown — first SIGINT tries clean stop, second forces exit
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      process.exit(1);
    }
    shuttingDown = true;
    scheduler.stop();
    try {
      await gateway.stop();
    } catch {
      // Best-effort — don't block exit
    }
    process.exit(0);
  };
  onShutdownSignal(() => void shutdown());

  await gateway.start();
  setChannelRegistry(gateway.getRegistry());
}

/**
 * `yojin web` — start the dashboard.
 *
 * In a local monorepo checkout with `apps/web` present, spawn the Vite dev
 * server on :5173 for hot reload. In a published npm install (where the web
 * bundle ships pre-built under `apps/web/dist`), fall back to `yojin start`
 * which serves the bundle from the gateway on :3000.
 */
function startFrontend(): Promise<void> {
  const webAppDir = resolve(resolvePackageRoot(), 'apps/web');
  const webPackageJson = join(webAppDir, 'package.json');
  const isMonorepoCheckout = existsSync(webPackageJson) && existsSync(join(webAppDir, 'vite.config.ts'));

  if (!isMonorepoCheckout) {
    console.log('Starting Yojin with the bundled dashboard...');
    return startGateway();
  }

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
  const acpSessionStore = new AcpSessionStore(`${dataRoot}/acp`);
  const { shutdown } = startAcpServer({ bridge, sessionStore: acpSessionStore });

  const gracefulShutdown = async () => {
    await shutdown();
    process.exit(0);
  };
  onShutdownSignal(() => void gracefulShutdown());
}

async function runInsights(): Promise<void> {
  console.log('Processing portfolio insights...\n');

  const { agentRuntime, services } = await buildFullRuntime();
  const orchestrator = new Orchestrator(agentRuntime);
  registerBuiltinWorkflows(orchestrator, {
    reflectionEngine: services.reflectionEngine,
    insightStore: services.insightStore,
    memoryStore: services.memoryStores.get('analyst'),
    snapStore: services.snapStore,
    profileStore: services.profileStore,
    gathererOptions: {
      snapshotStore: services.snapshotStore,
      signalArchive: services.signalArchive,
      insightStore: services.insightStore,
      getJintelClient: () => services.jintelToolOptions.client,
      memoryStores: services.memoryStores,
      profileStore: services.profileStore,
    },
  });

  const startMs = Date.now();
  const outputs = await orchestrator.execute('process-insights', {
    message: 'Process portfolio insights',
  });
  const durationMs = Date.now() - startMs;

  // Print summary
  const strategistOutput = outputs.get('strategist')?.text ?? '';
  console.log('--- Insight Report ---\n');
  console.log(strategistOutput);
  console.log(`\nCompleted in ${(durationMs / 1000).toFixed(1)}s`);

  // Check if a report was persisted
  const latest = await services.insightStore.getLatest();
  if (latest) {
    console.log(`Report saved: ${latest.id}`);
    console.log(`Portfolio health: ${latest.portfolio.overallHealth}`);
    console.log(`Positions analyzed: ${latest.positions.length}`);
    if (latest.portfolio.actionItems.length > 0) {
      console.log('\nAction items:');
      for (const item of latest.portfolio.actionItems) {
        console.log(`  - ${item.text}`);
      }
    }
  }

  process.exit(0);
}

function printHelp(): void {
  console.log(`
Yojin — Your personal AI finance agent

Commands:
  yojin [options]      Start Yojin (server + dashboard)
    --port <n>           Preferred port (default: 3000). Falls back to the
                         next free port if busy. Also settable via YOJIN_PORT.
    --verbose, -v        Stream structured logs to the console instead of
                         the splash (useful for debugging startup).
  yojin chat [options] Chat with Yojin in your terminal
    --model <model>      Model to use (default: claude-opus-4-6)
    --provider <id>      Provider to use (default: anthropic)
    --system <prompt>    System prompt
  yojin setup          Connect your Claude account
  yojin insights       Process portfolio insights (multi-agent analysis)
  yojin eval-strategies  Debug strategy evaluation (trace report)
    --tickers <syms>       Comma-separated tickers (default: all portfolio)
    --strategy <id>        Evaluate a single strategy only
    --dry-run              Skip Jintel fetch, use cached data
    --with-actions         Run LLM action generation + consistency checks

Advanced:
  yojin serve          Alias for start
  yojin web            Start the dashboard only
  yojin secret <cmd>   Manage stored credentials
  yojin acp            Start ACP (Agent Client Protocol) server
  yojin version        Print version
  yojin help           Show this message
`);
}
