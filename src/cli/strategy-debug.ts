/**
 * strategy-debug — CLI command for strategy evaluation trace output.
 *
 * Usage:
 *   yojin eval-strategies [--tickers AAPL,GOOG] [--strategy price-momentum] [--dry-run]
 *
 * Boots minimal services, builds a PortfolioContext (optionally with live Jintel data),
 * runs evaluation in trace mode, and writes a full Markdown report to ~/.yojin/debug/.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Entity } from '@yojinhq/jintel-client';
import { JintelClient } from '@yojinhq/jintel-client';

import type { AssetClass } from '../api/graphql/types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import { resolveDataRoot } from '../paths.js';
import { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';
import { SignalArchive } from '../signals/archive.js';
import type { Signal } from '../signals/types.js';
import { buildPortfolioContext } from '../strategies/portfolio-context-builder.js';
import type { PortfolioContext } from '../strategies/strategy-evaluator.js';
import { StrategyEvaluator } from '../strategies/strategy-evaluator.js';
import { StrategyStore } from '../strategies/strategy-store.js';
import { renderSummaryOnly, renderTraceReport } from '../strategies/trace-renderer.js';
import type { ContextBuildError, StrategyTraceReport } from '../strategies/trace-types.js';
import { FileAuditLog } from '../trust/audit/audit-log.js';
import { EncryptedVault } from '../trust/vault/vault.js';

const logger = createSubsystemLogger('strategy-debug');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface DebugArgs {
  tickers: string[] | null; // null = use all portfolio tickers
  strategy: string | null; // filter by id or name substring
  dryRun: boolean;
}

function parseArgs(args: string[]): DebugArgs {
  const result: DebugArgs = { tickers: null, strategy: null, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--tickers' && args[i + 1]) {
      result.tickers = args[++i].split(',').map((t) => t.trim().toUpperCase());
    } else if (arg === '--strategy' && args[i + 1]) {
      result.strategy = args[++i];
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Jintel helpers
// ---------------------------------------------------------------------------

async function tryBuildJintelClient(): Promise<JintelClient | null> {
  try {
    const auditLog = new FileAuditLog();
    const vault = new EncryptedVault({ auditLog });
    const autoUnlocked = await vault.tryAutoUnlock();
    if (!autoUnlocked) return null;

    const apiKey = await vault.get('jintel-api-key');
    if (!apiKey) return null;

    return new JintelClient({
      apiKey,
      baseUrl: process.env.JINTEL_API_URL,
      debug: process.env.JINTEL_DEBUG === '1',
      timeout: 60_000,
      cache: true,
    });
  } catch {
    return null;
  }
}

async function batchEnrich(client: JintelClient, tickers: string[], errors: ContextBuildError[]): Promise<Entity[]> {
  const CHUNK_SIZE = 20;
  const results: Entity[] = [];

  for (let i = 0; i < tickers.length; i += CHUNK_SIZE) {
    const chunk = tickers.slice(i, i + CHUNK_SIZE);
    const result = await client.batchEnrich(chunk, ['market', 'technicals', 'sentiment']);
    if (result.success) {
      results.push(...result.data);
    } else {
      errors.push({ phase: 'jintel-enrich', message: result.error, tickers: chunk });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Context building
// ---------------------------------------------------------------------------

async function buildContext(
  snapshot: {
    positions: { symbol: string; currentPrice: number; marketValue: number; assetClass?: AssetClass }[];
    totalValue: number;
  },
  signalArchive: SignalArchive,
  jintelClient: JintelClient | null,
  errors: ContextBuildError[],
): Promise<PortfolioContext> {
  const tickers = snapshot.positions.map((p) => p.symbol);

  if (!jintelClient || tickers.length === 0) {
    logger.info('Building snapshot-only PortfolioContext (no Jintel client)');
    return buildPortfolioContext(snapshot, [], []);
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const signalsP: Promise<Signal[]> = signalArchive.query({ tickers, since }).catch((err: unknown) => {
    errors.push({ phase: 'signal-archive', message: String(err) });
    return [];
  });

  const [quotesResult, entities, priceHistoryResult, signals] = await Promise.all([
    jintelClient.quotes(tickers).catch((err: unknown) => {
      errors.push({ phase: 'jintel-quotes', message: String(err) });
      return { success: false as const, error: String(err) };
    }),
    batchEnrich(jintelClient, tickers, errors),
    jintelClient.priceHistory(tickers, '1y', '1d').catch((err: unknown) => {
      errors.push({ phase: 'jintel-price-history', message: String(err) });
      return { success: false as const, error: String(err) };
    }),
    signalsP,
  ]);

  const quotes = quotesResult.success ? quotesResult.data : [];
  const histories = priceHistoryResult.success ? priceHistoryResult.data : [];

  const signalsByTicker: Record<string, Signal[]> = {};
  for (const sig of signals) {
    for (const link of sig.assets) {
      (signalsByTicker[link.ticker] ??= []).push(sig);
    }
  }

  logger.info('Built enriched PortfolioContext for debug evaluation', {
    tickers: tickers.length,
    quotesAvailable: quotes.length,
    entitiesAvailable: entities.length,
    historiesAvailable: histories.length,
    signalsAvailable: signals.length,
  });

  return buildPortfolioContext(snapshot, quotes, entities, histories, signalsByTicker);
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

export async function runStrategyDebug(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const dataRoot = resolveDataRoot();

  // Boot minimal services
  const snapshotStore = new PortfolioSnapshotStore(dataRoot);
  const signalArchive = new SignalArchive({ dir: join(dataRoot, 'signals') });
  const strategyStore = new StrategyStore({ dir: join(dataRoot, 'strategies') });
  const evaluator = new StrategyEvaluator(strategyStore);

  await strategyStore.initialize();

  // Load latest portfolio snapshot
  const snapshot = await snapshotStore.getLatest();
  if (!snapshot || snapshot.positions.length === 0) {
    console.error('No portfolio snapshot found. Import your portfolio first with `yojin start`.');
    process.exit(1);
  }

  // Apply ticker filter
  let filteredSnapshot = snapshot;
  if (opts.tickers && opts.tickers.length > 0) {
    const tickerSet = new Set(opts.tickers);
    const filteredPositions = snapshot.positions.filter((p) => tickerSet.has(p.symbol));
    if (filteredPositions.length === 0) {
      console.error(`None of the specified tickers (${opts.tickers.join(', ')}) found in portfolio.`);
      process.exit(1);
    }
    filteredSnapshot = {
      ...snapshot,
      positions: filteredPositions,
    };
  }

  // Build Jintel client unless --dry-run
  let jintelClient: JintelClient | null = null;
  if (!opts.dryRun) {
    jintelClient = await tryBuildJintelClient();
    if (!jintelClient) {
      console.warn('Jintel credentials not available — running in dry-run mode (cached data only).');
    }
  } else {
    console.log('Running in dry-run mode — skipping Jintel fetch.');
  }

  // Build portfolio context
  const contextErrors: ContextBuildError[] = [];
  const context = await buildContext(filteredSnapshot, signalArchive, jintelClient, contextErrors);

  // Compute per-strategy allocation data
  const activeStrategies = evaluator.getActiveStrategies();
  context.strategyAllocations = {};
  for (const strategy of activeStrategies) {
    if (strategy.targetAllocation == null) continue;
    const tickers = strategy.tickers.length > 0 ? strategy.tickers : Object.keys(context.weights);
    const actual = tickers.reduce((sum, t) => sum + (context.weights[t] ?? 0), 0);
    context.strategyAllocations[strategy.id] = {
      target: strategy.targetAllocation,
      actual,
      tickers,
    };
  }

  // Run evaluation in trace mode
  let report: StrategyTraceReport = evaluator.evaluate(context, { trace: true });

  // Inject context-build errors into the report
  if (contextErrors.length > 0) {
    report = { ...report, errors: [...report.errors, ...contextErrors] };
  }

  // Filter by --strategy flag (id or name substring match)
  if (opts.strategy) {
    const filter = opts.strategy.toLowerCase();
    report = {
      ...report,
      strategies: report.strategies.filter(
        (s) => s.strategyId.toLowerCase().includes(filter) || s.strategyName.toLowerCase().includes(filter),
      ),
    };
  }

  // Render full Markdown report and write to debug directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const debugDir = join(dataRoot, 'debug');
  await mkdir(debugDir, { recursive: true });

  const filename = `strategy-eval-${timestamp}.md`;
  const filePath = join(debugDir, filename);
  const markdown = renderTraceReport(report);
  await writeFile(filePath, markdown, 'utf-8');

  // Print summary to terminal
  console.log('\n' + renderSummaryOnly(report));
  console.log(`\nFull trace report written to: ${filePath}`);
}
