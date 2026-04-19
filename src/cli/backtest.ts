/**
 * backtest — CLI command for deterministic strategy replay + scoring.
 *
 * Usage:
 *   yojin backtest --strategy <id>
 *                  [--since YYYY-MM-DD] [--until YYYY-MM-DD]
 *                  [--horizon-days N] [--output path.md] [--json]
 *
 * Writes a Markdown scorecard to `debug/backtest-<strategyId>-<timestamp>.md`
 * and an optional JSON companion for programmatic consumption.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { JintelClient } from '@yojinhq/jintel-client';

import { ContextReconstructor } from '../backtest/context-reconstructor.js';
import { PriceHistoryProvider, shiftDays } from '../backtest/price-history.js';
import { scorecardToMarkdown } from '../backtest/report-formatter.js';
import { BacktestRunner } from '../backtest/runner.js';
import { ActionScorer } from '../backtest/scorer.js';
import type { BacktestConfig } from '../backtest/types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import { resolveDataRoot } from '../paths.js';
import { SignalArchive } from '../signals/archive.js';
import { StrategyEvaluator } from '../strategies/strategy-evaluator.js';
import { StrategyStore } from '../strategies/strategy-store.js';
import type { Strategy } from '../strategies/types.js';
import { FileAuditLog } from '../trust/audit/audit-log.js';
import { EncryptedVault } from '../trust/vault/vault.js';

const logger = createSubsystemLogger('backtest-cli');

interface BacktestArgs {
  strategy: string | null;
  since: string | null;
  until: string | null;
  horizonDays: number;
  output: string | null;
  json: boolean;
}

function parseArgs(args: string[]): BacktestArgs {
  const result: BacktestArgs = {
    strategy: null,
    since: null,
    until: null,
    horizonDays: 30,
    output: null,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--strategy') result.strategy = requireValue(args, ++i, arg);
    else if (arg === '--since') result.since = requireValue(args, ++i, arg);
    else if (arg === '--until') result.until = requireValue(args, ++i, arg);
    else if (arg === '--horizon-days') {
      const n = Number(requireValue(args, ++i, arg));
      if (!Number.isInteger(n) || n <= 0) {
        console.error('Error: --horizon-days must be a positive integer');
        process.exit(1);
      }
      result.horizonDays = n;
    } else if (arg === '--output') result.output = requireValue(args, ++i, arg);
    else if (arg === '--json') result.json = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return result;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    console.error(`Error: ${flag} requires a value`);
    process.exit(1);
  }
  return value;
}

function printHelp(): void {
  console.log(`Usage: yojin backtest --strategy <id> [options]

Options:
  --strategy <id>         Strategy ID to backtest (required)
  --since <YYYY-MM-DD>    Start date (default: 90 days ago)
  --until <YYYY-MM-DD>    End date (default: today − horizon)
  --horizon-days <n>      Holding horizon per action (default: 30)
  --output <path>         Markdown output path (default: debug/backtest-<id>-<ts>.md)
  --json                  Also emit JSON scorecard at <output>.json
`);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

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
  } catch (err) {
    logger.debug('Jintel client initialization failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** In-memory StrategyStore exposing a single strategy forced to `active`. */
class SingleStrategyStore {
  constructor(private readonly strategy: Strategy) {}
  getAll(): Strategy[] {
    return [this.strategy];
  }
  getActive(): Strategy[] {
    return [this.strategy];
  }
  getById(id: string): Strategy | undefined {
    return this.strategy.id === id ? this.strategy : undefined;
  }
}

export async function runBacktest(args: string[]): Promise<void> {
  const opts = parseArgs(args);

  if (!opts.strategy) {
    console.error('Error: --strategy is required');
    printHelp();
    process.exit(1);
  }

  const horizonDays = opts.horizonDays;
  const until = opts.until ?? shiftDays(todayIsoDate(), -horizonDays);
  const since = opts.since ?? shiftDays(until, -90);

  if (since > until) {
    console.error(`Error: --since (${since}) must be ≤ --until (${until})`);
    process.exit(1);
  }

  const dataRoot = resolveDataRoot();

  const strategyStore = new StrategyStore({ dir: join(dataRoot, 'strategies') });
  await strategyStore.initialize();
  const strategy = strategyStore.getById(opts.strategy);
  if (!strategy) {
    console.error(`Error: strategy "${opts.strategy}" not found in ${join(dataRoot, 'strategies')}`);
    process.exit(1);
  }

  const forcedActive: Strategy = { ...strategy, active: true };
  const singleStore = new SingleStrategyStore(forcedActive);
  const evaluator = new StrategyEvaluator(singleStore as unknown as StrategyStore);

  const signalArchive = new SignalArchive({ dir: join(dataRoot, 'signals') });

  const jintelClient = await tryBuildJintelClient();
  if (!jintelClient) {
    console.warn('Jintel credentials not available — backtest will rely on cached price history only.');
  }

  const priceHistory = new PriceHistoryProvider({
    client: jintelClient,
    cacheDir: join(dataRoot, 'cache', 'price-history'),
  });

  const contextReconstructor = new ContextReconstructor({ priceHistory, signalArchive });
  const scorer = new ActionScorer(priceHistory);

  const runner = new BacktestRunner({ evaluator, contextReconstructor, priceHistory, scorer });

  const config: BacktestConfig = {
    strategyId: strategy.id,
    since,
    until,
    horizonDays,
  };

  console.log(`Running backtest: ${strategy.name} (${strategy.id})`);
  console.log(`  Window: ${since} → ${until} | horizon: ${horizonDays}d`);

  const scorecard = await runner.run(forcedActive, config);

  const debugDir = join(dataRoot, 'debug');
  await mkdir(debugDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = opts.output ?? join(debugDir, `backtest-${strategy.id}-${timestamp}.md`);

  const markdown = scorecardToMarkdown(scorecard);
  await writeFile(outputPath, markdown, 'utf-8');
  console.log(`\nScorecard written to: ${outputPath}`);

  if (opts.json) {
    const jsonPath = outputPath.replace(/\.md$/, '') + '.json';
    await writeFile(jsonPath, JSON.stringify(scorecard, null, 2), 'utf-8');
    console.log(`JSON scorecard:       ${jsonPath}`);
  }

  console.log(
    `\nScore: ${scorecard.score.toFixed(4)} (hitRate ${(scorecard.hitRate * 100).toFixed(2)}%, avgReturn ${scorecard.avgReturn.toFixed(3)}%, actions ${scorecard.actionCount})`,
  );

  process.exit(0);
}
