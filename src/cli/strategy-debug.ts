/**
 * strategy-debug — CLI command for strategy evaluation trace output.
 *
 * Usage:
 *   yojin eval-strategies [--tickers AAPL,GOOG] [--strategy price-momentum] [--dry-run]
 *                         [--with-actions]
 *
 * Boots minimal services, builds a PortfolioContext (optionally with live Jintel data),
 * runs evaluation in trace mode, and writes a full Markdown report to ~/.yojin/debug/.
 *
 * --with-actions: extends the trace with an LLM action-generation eval. For each fired
 * trigger, sends the evaluation through the real ProviderRouter (same prompt as the
 * scheduler), then runs deterministic consistency checks on the LLM output:
 *   - FORMAT:    Did the LLM respond with the required ACTION: headline?
 *   - VERDICT:   Is the parsed verdict valid (BUY/SELL/TRIM/HOLD/REVIEW)?
 *   - TICKER:    Does the headline contain the correct ticker?
 *   - DATA_REF:  Does the reasoning reference the trigger's data points?
 *   - DIRECTION: Is the verdict directionally consistent with the trigger?
 * Results are appended as a "Layer 4" section to the Markdown report.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Entity } from '@yojinhq/jintel-client';
import { JintelClient } from '@yojinhq/jintel-client';

import type { ActionVerdict } from '../actions/types.js';
import { ClaudeCodeProvider } from '../ai-providers/claude-code.js';
import { ProviderRouter } from '../ai-providers/router.js';
import type { AssetClass } from '../api/graphql/types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import { resolveDataRoot } from '../paths.js';
import { PortfolioSnapshotStore } from '../portfolio/snapshot-store.js';
import { SignalArchive } from '../signals/archive.js';
import type { Signal } from '../signals/types.js';
import { generateActionReasoning } from '../strategies/action-reasoning.js';
import { formatTriggerContext } from '../strategies/format-trigger-context.js';
import { buildPortfolioContext } from '../strategies/portfolio-context-builder.js';
import type { PortfolioContext } from '../strategies/strategy-evaluator.js';
import { StrategyEvaluator } from '../strategies/strategy-evaluator.js';
import { StrategyStore } from '../strategies/strategy-store.js';
import { renderSummaryOnly, renderTraceReport } from '../strategies/trace-renderer.js';
import type { ContextBuildError, StrategyTraceReport } from '../strategies/trace-types.js';
import type { StrategyEvaluation } from '../strategies/types.js';
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
  withActions: boolean; // run LLM action generation + consistency checks
}

function parseArgs(args: string[]): DebugArgs {
  const result: DebugArgs = { tickers: null, strategy: null, dryRun: false, withActions: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--with-actions') {
      result.withActions = true;
    } else if (arg === '--tickers') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) {
        console.error('Error: --tickers requires a comma-separated list of symbols');
        process.exit(1);
      }
      result.tickers = args[++i].split(',').map((t) => t.trim().toUpperCase());
    } else if (arg === '--strategy') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) {
        console.error('Error: --strategy requires a strategy id or name');
        process.exit(1);
      }
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
  } catch (err) {
    logger.debug('Jintel client initialization failed', { error: err instanceof Error ? err.message : String(err) });
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
      errors.push({ phase: 'jintel-enrich', message: String(result.error), tickers: chunk });
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
// LLM action eval — consistency checks on the REAL production code path
// ---------------------------------------------------------------------------

type CheckResult = 'PASS' | 'FAIL' | 'WARN';

interface ConsistencyCheck {
  name: string;
  result: CheckResult;
  detail: string;
}

interface ActionEvalResult {
  strategyName: string;
  ticker: string;
  triggerType: string;
  triggerStrength: string;
  rawLlmOutput: string;
  headline: string;
  verdict: ActionVerdict;
  reasoning: string;
  checks: ConsistencyCheck[];
  passed: number;
  warned: number;
  failed: number;
}

/**
 * Verdicts that are directionally inconsistent with the trigger type.
 * Key = trigger type, value = set of verdicts that should NEVER appear.
 */
const CONTRADICTORY_VERDICTS: Record<string, Set<ActionVerdict>> = {
  DRAWDOWN: new Set(['BUY']),
  CONCENTRATION_DRIFT: new Set(['BUY']),
};

function runConsistencyChecks(
  evaluation: StrategyEvaluation,
  rawOutput: string,
  headline: string,
  verdict: ActionVerdict,
  reasoning: string,
): ConsistencyCheck[] {
  const checks: ConsistencyCheck[] = [];
  const ticker = (evaluation.context.ticker as string | undefined) ?? '';

  // 1. FORMAT — did the LLM follow the ACTION: headline format?
  const hasActionPrefix = /^ACTION:\s*.+/im.test(rawOutput);
  checks.push({
    name: 'FORMAT',
    result: hasActionPrefix ? 'PASS' : 'FAIL',
    detail: hasActionPrefix ? 'ACTION: headline found' : 'Missing ACTION: prefix — LLM ignored prompt format',
  });

  // 2. VERDICT — is the parsed verdict valid (not a fallback REVIEW from parse failure)?
  const verdictMatch = headline.match(/^(BUY|SELL|TRIM|HOLD|REVIEW)\b/i);
  checks.push({
    name: 'VERDICT',
    result: verdictMatch ? 'PASS' : 'WARN',
    detail: verdictMatch ? `Parsed verdict: ${verdict}` : `No explicit verdict in headline — defaulted to REVIEW`,
  });

  // 3. TICKER — does the headline contain the correct ticker?
  if (ticker) {
    const tickerInHeadline = headline.toUpperCase().includes(ticker.toUpperCase());
    checks.push({
      name: 'TICKER',
      result: tickerInHeadline ? 'PASS' : 'FAIL',
      detail: tickerInHeadline
        ? `Ticker ${ticker} found in headline`
        : `Expected ticker ${ticker} in headline, got: "${headline}"`,
    });
  }

  // 4. DATA_REF — does the reasoning reference key trigger data points?
  const contextParts = formatTriggerContext(evaluation.context);
  const fullText = (headline + ' ' + reasoning).toLowerCase();
  const contextValues = contextParts
    .map((p) => {
      const match = p.match(/:\s*([0-9.-]+%?)/);
      return match?.[1];
    })
    .filter(Boolean) as string[];
  const referencedCount = contextValues.filter((v) => fullText.includes(v.replace('%', ''))).length;
  const dataRefRatio = contextValues.length > 0 ? referencedCount / contextValues.length : 1;
  checks.push({
    name: 'DATA_REF',
    result: dataRefRatio >= 0.3 ? 'PASS' : 'WARN',
    detail:
      dataRefRatio >= 0.3
        ? `${referencedCount}/${contextValues.length} trigger data points referenced`
        : `Only ${referencedCount}/${contextValues.length} trigger data points referenced — LLM may be ignoring context`,
  });

  // 5. DIRECTION — is the verdict directionally consistent with the trigger?
  const contradictions = CONTRADICTORY_VERDICTS[evaluation.triggerType];
  if (contradictions) {
    const isContradictory = contradictions.has(verdict);
    checks.push({
      name: 'DIRECTION',
      result: isContradictory ? 'FAIL' : 'PASS',
      detail: isContradictory
        ? `${verdict} contradicts ${evaluation.triggerType} trigger — should be ${['SELL', 'TRIM', 'REVIEW'].filter((v) => v !== verdict).join('/')}`
        : `${verdict} is directionally consistent with ${evaluation.triggerType}`,
    });
  } else {
    checks.push({
      name: 'DIRECTION',
      result: 'PASS',
      detail: `${evaluation.triggerType} has no fixed directional expectation — verdict ${verdict} accepted`,
    });
  }

  return checks;
}

async function tryBuildProviderRouter(dataRoot: string): Promise<ProviderRouter | null> {
  try {
    const providerRouter = new ProviderRouter({ configPath: `${dataRoot}/config/ai-provider.json` });
    const claudeProvider = new ClaudeCodeProvider();
    await claudeProvider.initialize();
    providerRouter.registerBackend(claudeProvider);
    await providerRouter.loadConfig();
    return providerRouter;
  } catch (err) {
    logger.debug('ProviderRouter initialization failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

/**
 * Run each evaluation through generateActionReasoning() — the SAME function
 * the Scheduler uses in production — then apply deterministic consistency checks.
 */
async function runActionEval(
  evaluations: StrategyEvaluation[],
  providerRouter: ProviderRouter,
): Promise<ActionEvalResult[]> {
  const results: ActionEvalResult[] = [];

  for (const evaluation of evaluations) {
    const ticker = (evaluation.context.ticker as string | undefined) ?? 'portfolio';

    console.log(`  Evaluating: ${evaluation.strategyName} → ${ticker}...`);

    // Call the SAME function the scheduler calls — single source of truth
    const result = await generateActionReasoning(evaluation, providerRouter);

    if (!result.fromLlm) {
      results.push({
        strategyName: evaluation.strategyName,
        ticker,
        triggerType: evaluation.triggerType,
        triggerStrength: evaluation.triggerStrength,
        rawLlmOutput: '',
        headline: result.headline,
        verdict: result.verdict,
        reasoning: result.reasoning,
        checks: [
          {
            name: 'LLM_CALL',
            result: 'FAIL',
            detail: 'LLM call failed or unavailable — got static fallback',
          },
        ],
        passed: 0,
        warned: 0,
        failed: 1,
      });
      continue;
    }

    const checks = runConsistencyChecks(
      evaluation,
      result.rawOutput,
      result.headline,
      result.verdict,
      result.reasoning,
    );
    const passed = checks.filter((c) => c.result === 'PASS').length;
    const warned = checks.filter((c) => c.result === 'WARN').length;
    const failed = checks.filter((c) => c.result === 'FAIL').length;

    results.push({
      strategyName: evaluation.strategyName,
      ticker,
      triggerType: evaluation.triggerType,
      triggerStrength: evaluation.triggerStrength,
      rawLlmOutput: result.rawOutput,
      headline: result.headline,
      verdict: result.verdict,
      reasoning: result.reasoning,
      checks,
      passed,
      warned,
      failed,
    });
  }

  return results;
}

function renderActionEvalReport(results: ActionEvalResult[]): string {
  const lines: string[] = ['## Action Generation Eval', ''];

  // Summary
  const totalChecks = results.reduce((s, r) => s + r.checks.length, 0);
  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalWarned = results.reduce((s, r) => s + r.warned, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  lines.push(
    `**${results.length} evaluations** — ${totalPassed}/${totalChecks} checks passed, ${totalWarned} warnings, ${totalFailed} failures`,
  );
  lines.push('');

  const RESULT_ICONS: Record<CheckResult, string> = { PASS: '✅', WARN: '⚠️', FAIL: '❌' };

  for (const result of results) {
    const icon = result.failed > 0 ? '❌' : result.warned > 0 ? '⚠️' : '✅';
    lines.push(`### ${icon} ${result.strategyName} → ${result.ticker}`);
    lines.push('');
    lines.push(`- **Trigger:** ${result.triggerType} (${result.triggerStrength})`);
    lines.push(`- **Verdict:** ${result.verdict}`);
    lines.push(`- **Headline:** ${result.headline}`);
    lines.push('');

    // Checks
    lines.push('**Consistency checks:**');
    lines.push('');
    for (const check of result.checks) {
      lines.push(`- ${RESULT_ICONS[check.result]} **${check.name}**: ${check.detail}`);
    }
    lines.push('');

    // Reasoning (collapsed for readability)
    lines.push('<details><summary>LLM reasoning</summary>');
    lines.push('');
    lines.push(result.reasoning || '*No reasoning produced*');
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  return lines.join('\n');
}

function renderActionEvalSummary(results: ActionEvalResult[]): string {
  const lines: string[] = ['### Action Eval Results', ''];

  for (const r of results) {
    const icon = r.failed > 0 ? '❌' : r.warned > 0 ? '⚠️' : '✅';
    const checkSummary = `${r.passed}P ${r.warned}W ${r.failed}F`;
    lines.push(`${icon} ${r.strategyName} → ${r.ticker}: ${r.verdict} [${checkSummary}]`);
  }

  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  const totalWarned = results.reduce((s, r) => s + r.warned, 0);
  lines.push('');
  if (totalFailed > 0) {
    lines.push(`**${totalFailed} check(s) FAILED** — review the full report for details.`);
  } else if (totalWarned > 0) {
    lines.push(`All critical checks passed. ${totalWarned} warning(s) — review if needed.`);
  } else {
    lines.push('All checks passed.');
  }

  return lines.join('\n');
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

  // Run evaluation — get both evaluations (for LLM) and trace report (for display)
  const evaluations: StrategyEvaluation[] = evaluator.evaluate(context);
  let report: StrategyTraceReport = evaluator.evaluate(context, { trace: true });

  // Inject context-build errors into the report
  if (contextErrors.length > 0) {
    report = { ...report, errors: [...report.errors, ...contextErrors] };
  }

  // Filter by --strategy flag (id or name substring match) and recalculate summary
  let filteredEvaluations = evaluations;
  if (opts.strategy) {
    const filter = opts.strategy.toLowerCase();
    const filtered = report.strategies.filter(
      (s) => s.strategyId.toLowerCase().includes(filter) || s.strategyName.toLowerCase().includes(filter),
    );
    const matchingIds = new Set(filtered.map((s) => s.strategyId));
    filteredEvaluations = evaluations.filter((e) => matchingIds.has(e.strategyId));
    const firedCount = filtered.filter((s) => s.result === 'FIRED').length;
    const firedList = report.summary.firedList.filter((f) => filtered.some((s) => s.strategyName === f.strategy));
    report = {
      ...report,
      strategies: filtered,
      summary: {
        ...report.summary,
        totalStrategies: filtered.length,
        activeStrategies: filtered.filter((s) => s.active).length,
        fired: firedCount,
        noMatch: filtered.filter((s) => s.result === 'NO_MATCH').length,
        firedList,
      },
    };
  }

  // Render full Markdown report
  const reportSections: string[] = [renderTraceReport(report)];

  // Print summary to terminal
  console.log('\n' + renderSummaryOnly(report));

  // --with-actions: run LLM action generation + consistency checks
  if (opts.withActions && filteredEvaluations.length > 0) {
    console.log(`\n--- Action Eval: sending ${filteredEvaluations.length} fired trigger(s) to LLM ---\n`);

    const providerRouter = await tryBuildProviderRouter(dataRoot);
    if (!providerRouter) {
      console.error('Cannot run action eval — AI provider not configured. Run `yojin setup` first.');
    } else {
      const actionResults = await runActionEval(filteredEvaluations, providerRouter);
      reportSections.push('\n---\n\n' + renderActionEvalReport(actionResults));
      console.log('\n' + renderActionEvalSummary(actionResults));
    }
  } else if (opts.withActions && filteredEvaluations.length === 0) {
    console.log('\n--with-actions: no triggers fired — nothing to evaluate.');
  }

  // Write to debug directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const debugDir = join(dataRoot, 'debug');
  await mkdir(debugDir, { recursive: true });

  const filename = `strategy-eval-${timestamp}.md`;
  const filePath = join(debugDir, filename);
  await writeFile(filePath, reportSections.join(''), 'utf-8');

  console.log(`\nFull report written to: ${filePath}`);

  // Force exit — the Anthropic SDK keeps connections alive, preventing clean shutdown.
  if (opts.withActions) process.exit(0);
}
