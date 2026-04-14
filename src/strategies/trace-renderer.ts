/**
 * Trace report renderer — converts a StrategyTraceReport into human-readable Markdown.
 *
 * Two exported functions:
 *   renderTraceReport(report)   — full 3-layer Markdown report
 *   renderSummaryOnly(report)   — terminal-friendly summary only
 */

import type { PortfolioContext } from './strategy-evaluator.js';
import type { ConditionResult, StrategyTrace, StrategyTraceReport } from './trace-types.js';

// ---------------------------------------------------------------------------
// Result icons
// ---------------------------------------------------------------------------

const RESULT_ICONS: Record<ConditionResult, string> = {
  PASS: '✅',
  FAIL: '❌',
  NO_DATA: '⚠️',
  ERROR: '💥',
};

// ---------------------------------------------------------------------------
// Indicator grouping — split wide tables into readable sections
// ---------------------------------------------------------------------------

const INDICATOR_GROUPS: { label: string; keys: string[] }[] = [
  {
    label: 'Oscillators',
    keys: ['RSI', 'MFI', 'WILLIAMS_R', 'STOCH_K', 'STOCH_D'],
  },
  {
    label: 'Trend & Momentum',
    keys: ['MACD', 'MACD_LINE', 'MACD_SIGNAL', 'ADX', 'PSAR'],
  },
  {
    label: 'Moving Averages',
    keys: ['EMA', 'EMA_50', 'EMA_200', 'SMA', 'SMA_20', 'SMA_200', 'VWMA', 'VWAP', 'WMA_52'],
  },
  {
    label: 'Volatility',
    keys: ['ATR', 'BB_LOWER', 'BB_MIDDLE', 'BB_UPPER', 'BB_WIDTH'],
  },
  {
    label: 'Volume & Crossovers',
    keys: ['OBV', 'GOLDEN_CROSS', 'DEATH_CROSS', 'EMA_CROSS'],
  },
];

// ---------------------------------------------------------------------------
// Number formatters
// ---------------------------------------------------------------------------

export function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(n: number, fractional = false): string {
  if (!Number.isFinite(n)) return '—';
  const v = fractional ? n * 100 : n;
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

export function formatValue(v: number | string | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(2);
}

// ---------------------------------------------------------------------------
// Table alignment — pads cells so columns are visually aligned in plain text
// ---------------------------------------------------------------------------

/**
 * Build an aligned Markdown table from rows of string cells.
 * Each row must have the same number of cells.
 * Returns the full table string including header and separator.
 */
function alignedTable(headers: string[], rows: string[][]): string {
  // Compute max width per column (accounting for emoji double-width display)
  const colWidths = headers.map((h, i) => {
    const cellWidths = rows.map((r) => displayWidth(r[i] ?? ''));
    return Math.max(displayWidth(h), ...cellWidths);
  });

  const padCell = (text: string, colIdx: number) => {
    const pad = colWidths[colIdx] - displayWidth(text);
    return text + ' '.repeat(Math.max(0, pad));
  };

  const headerLine = '| ' + headers.map((h, i) => padCell(h, i)).join(' | ') + ' |';
  const sepLine = '|' + colWidths.map((w) => '-'.repeat(w + 2)).join('|') + '|';
  const bodyLines = rows.map((row) => '| ' + row.map((c, i) => padCell(c, i)).join(' | ') + ' |');

  return [headerLine, sepLine, ...bodyLines].join('\n');
}

/** Approximate display width — emojis count as 2, others as 1. */
function displayWidth(s: string): number {
  // Simple heuristic: count common emojis (✅❌⚠️💥🔥⚪) as 2 chars each
  let width = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    // Emoji ranges (simplified): Miscellaneous Symbols, Dingbats, Emoticons, etc.
    if (code > 0x2000) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

// ---------------------------------------------------------------------------
// Layer 1 — Summary
// ---------------------------------------------------------------------------

function renderSummaryTable(report: StrategyTraceReport): string {
  const { strategies, summary } = report;

  const headers = ['Strategy', 'Tickers', 'Fired', 'Missed', 'No Data', 'Errors', 'Strongest'];
  const rows: string[][] = [];

  for (const st of strategies) {
    if (!st.active) continue;

    let fired = 0;
    let missed = 0;
    let noData = 0;
    let errors = 0;

    for (const group of st.groups) {
      for (const tickerGroup of group.tickers) {
        if (tickerGroup.groupResult === 'PASS') {
          fired++;
        } else {
          const hasError = tickerGroup.conditions.some((c) => c.result === 'ERROR');
          const hasNoData = tickerGroup.conditions.some((c) => c.result === 'NO_DATA');
          if (hasError) {
            errors++;
          } else if (hasNoData) {
            noData++;
          } else {
            missed++;
          }
        }
      }
    }

    const strongest = st.winningStrength ?? '—';
    rows.push([
      st.strategyName,
      String(st.scopedTickers.length),
      String(fired),
      String(missed),
      String(noData),
      String(errors),
      strongest,
    ]);
  }

  const lines = [
    '## Summary',
    '',
    alignedTable(headers, rows),
    '',
    `**Result: ${summary.fired} trigger(s) fired across ${summary.fired}/${summary.activeStrategies} active strategies**`,
  ];

  return lines.join('\n');
}

function renderContextBuildErrors(report: StrategyTraceReport): string | null {
  if (report.errors.length === 0) return null;

  const lines = ['## Errors During Context Build', ''];
  for (const err of report.errors) {
    const tickerSuffix = err.tickers && err.tickers.length > 0 ? ` (${err.tickers.join(', ')})` : '';
    lines.push(`- **${err.phase}**: ${err.message}${tickerSuffix}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Layer 2 — Per-strategy breakdown
// ---------------------------------------------------------------------------

function renderStrategySection(st: StrategyTrace): string {
  const lines: string[] = [];

  const status = st.result === 'FIRED' ? '🔥 FIRED' : '⚪ NO_MATCH';
  lines.push(`### ${st.strategyName} — ${status}`);
  lines.push('');

  // Scoped tickers
  if (st.scopedTickers.length > 0) {
    lines.push(`**Scoped tickers:** ${st.scopedTickers.join(', ')}`);
  }

  // Filtered-out tickers
  if (st.filteredOutTickers.length > 0) {
    lines.push('');
    lines.push('**Filtered out:**');
    for (const f of st.filteredOutTickers) {
      lines.push(`- ${f.ticker}: ${f.reason}`);
    }
  }

  lines.push('');

  for (const group of st.groups) {
    if (group.skipped) {
      lines.push(
        `**Group ${group.groupIndex + 1}** *(${group.label || 'Group ' + (group.groupIndex + 1)})*: skipped — ${group.skipped}`,
      );
      lines.push('');
      continue;
    }

    lines.push(`**Group ${group.groupIndex + 1}** *(${group.label || 'Group ' + (group.groupIndex + 1)})*`);
    lines.push('');

    if (group.tickers.length === 0) {
      lines.push('*No tickers evaluated for this group.*');
      lines.push('');
      continue;
    }

    // Condition columns from first ticker (all tickers have same conditions in a group)
    const firstConditions = group.tickers[0].conditions;
    if (firstConditions.length > 0) {
      const condHeaders = firstConditions.map((c) => c.description.replace(/\|/g, '\\|'));
      const tableHeaders = ['Ticker', ...condHeaders, 'Result', 'Strength'];
      const tableRows: string[][] = [];

      for (const tg of group.tickers) {
        const cells = tg.conditions.map((c) => {
          const icon = RESULT_ICONS[c.result];
          const val = formatValue(c.actualValue);
          return `${icon} ${val}`;
        });
        const resultIcon = tg.groupResult === 'PASS' ? '✅' : '❌';
        const strength = tg.groupStrength ?? '—';
        tableRows.push([`**${tg.ticker}**`, ...cells, resultIcon, strength]);
      }

      lines.push(alignedTable(tableHeaders, tableRows));
      lines.push('');
    }
  }

  // Winning group for multi-group strategies that fired
  if (st.result === 'FIRED' && st.winningGroup !== undefined && st.groups.length > 1) {
    const winningGroupData = st.groups.find((g) => g.groupIndex === st.winningGroup);
    if (winningGroupData) {
      lines.push('**Winner (OR across groups)**');
      lines.push('');
      const winningTickers = winningGroupData.tickers
        .filter((tg) => tg.groupResult === 'PASS')
        .map((tg) => `${tg.ticker} (${tg.groupStrength ?? 'MODERATE'})`)
        .join(', ');
      lines.push(`Group ${winningGroupData.groupIndex + 1} fired for: ${winningTickers}`);
      lines.push('');
    }
  }

  // Closest miss hint for NO_MATCH strategies
  if (st.result === 'NO_MATCH') {
    const closestMiss = findClosestMiss(st);
    if (closestMiss) {
      lines.push(
        `**Closest miss:** ${closestMiss.ticker} — ${closestMiss.passCount}/${closestMiss.totalCount} conditions passed`,
      );
      lines.push('');
    }
  }

  return lines.join('\n');
}

interface ClosestMiss {
  ticker: string;
  passCount: number;
  totalCount: number;
}

function findClosestMiss(st: StrategyTrace): ClosestMiss | null {
  let best: ClosestMiss | null = null;

  for (const group of st.groups) {
    for (const tg of group.tickers) {
      if (tg.groupResult === 'PASS') continue;
      const totalCount = tg.conditions.length;
      const passCount = tg.conditions.filter((c) => c.result === 'PASS').length;
      if (!best || passCount > best.passCount || (passCount === best.passCount && totalCount < best.totalCount)) {
        best = { ticker: tg.ticker, passCount, totalCount };
      }
    }
  }

  return best;
}

function renderPerStrategySection(report: StrategyTraceReport): string {
  const activeStrategies = report.strategies.filter((s) => s.active);
  if (activeStrategies.length === 0) return '';

  const lines = ['## Strategy Breakdown', ''];

  for (const st of activeStrategies) {
    lines.push(renderStrategySection(st));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Layer 3 — Portfolio context appendix
// ---------------------------------------------------------------------------

function renderPortfolioContextAppendix(ctx: PortfolioContext): string {
  const lines: string[] = ['## Portfolio Context', ''];

  const tickers = Object.keys(ctx.prices);
  if (tickers.length === 0) {
    lines.push('*No portfolio positions.*');
    return lines.join('\n');
  }

  // Prices & Changes
  lines.push('### Prices & Changes');
  lines.push('');
  const priceHeaders = ['Ticker', 'Price', '1-Day Change', 'Period Return'];
  const priceRows: string[][] = [];
  for (const ticker of tickers) {
    const price = ctx.prices[ticker] ?? 0;
    const change = ctx.priceChanges[ticker];
    const period = ctx.periodReturns?.[ticker];
    priceRows.push([
      ticker,
      formatPrice(price),
      change !== undefined ? formatPercent(change, true) : '—',
      period !== undefined ? formatPercent(period, true) : '—',
    ]);
  }
  lines.push(alignedTable(priceHeaders, priceRows));
  lines.push('');

  // Indicators — split into logical groups so tables stay readable
  const tickersWithIndicators = tickers.filter((t) => ctx.indicators[t] && Object.keys(ctx.indicators[t]).length > 0);
  if (tickersWithIndicators.length > 0) {
    const allIndicatorKeys = new Set<string>();
    for (const ticker of tickersWithIndicators) {
      for (const key of Object.keys(ctx.indicators[ticker])) {
        allIndicatorKeys.add(key);
      }
    }

    // Build case-insensitive lookup: uppercase key → actual key in the data
    const upperToActual = new Map<string, string>();
    for (const k of allIndicatorKeys) {
      upperToActual.set(k.toUpperCase(), k);
    }

    const renderedKeys = new Set<string>();

    for (const group of INDICATOR_GROUPS) {
      const keys = group.keys
        .map((k) => upperToActual.get(k.toUpperCase()))
        .filter((k): k is string => k !== undefined);
      if (keys.length === 0) continue;

      for (const k of keys) renderedKeys.add(k);
      lines.push(`### ${group.label}`);
      lines.push('');
      const indRows: string[][] = [];
      for (const ticker of tickersWithIndicators) {
        const vals = keys.map((k) => {
          const v = ctx.indicators[ticker]?.[k];
          return v !== undefined ? v.toFixed(2) : '—';
        });
        indRows.push([ticker, ...vals]);
      }
      lines.push(alignedTable(['Ticker', ...keys], indRows));
      lines.push('');
    }

    // Catch-all: any indicator keys not in a defined group
    const ungrouped = [...allIndicatorKeys].filter((k) => !renderedKeys.has(k)).sort();
    if (ungrouped.length > 0) {
      lines.push('### Other Indicators');
      lines.push('');
      const indRows: string[][] = [];
      for (const ticker of tickersWithIndicators) {
        const vals = ungrouped.map((k) => {
          const v = ctx.indicators[ticker]?.[k];
          return v !== undefined ? v.toFixed(2) : '—';
        });
        indRows.push([ticker, ...vals]);
      }
      lines.push(alignedTable(['Ticker', ...ungrouped], indRows));
      lines.push('');
    }
  }

  // Metrics
  const tickersWithMetrics = tickers.filter((t) => ctx.metrics[t] && Object.keys(ctx.metrics[t]).length > 0);
  if (tickersWithMetrics.length > 0) {
    const allMetricKeys = new Set<string>();
    for (const ticker of tickersWithMetrics) {
      for (const key of Object.keys(ctx.metrics[ticker])) {
        allMetricKeys.add(key);
      }
    }
    const metricKeys = [...allMetricKeys].sort();

    lines.push('### Metrics');
    lines.push('');
    const metricRows: string[][] = [];
    for (const ticker of tickersWithMetrics) {
      const vals = metricKeys.map((k) => {
        const v = ctx.metrics[ticker]?.[k];
        return v !== undefined ? v.toFixed(2) : '—';
      });
      metricRows.push([ticker, ...vals]);
    }
    lines.push(alignedTable(['Ticker', ...metricKeys], metricRows));
    lines.push('');
  }

  // Signals (last 24h, max 10 per ticker)
  const tickersWithSignals = tickers.filter((t) => ctx.signals[t] && ctx.signals[t].length > 0);
  if (tickersWithSignals.length > 0) {
    lines.push('### Signals (last 24h)');
    lines.push('');
    for (const ticker of tickersWithSignals) {
      const signals = ctx.signals[ticker].slice(0, 10);
      lines.push(`**${ticker}**`);
      lines.push('');
      for (const sig of signals) {
        const score =
          sig.sentimentScore !== undefined && sig.sentimentScore !== null
            ? ` (${sig.sentimentScore > 0 ? '+' : ''}${sig.sentimentScore.toFixed(2)})`
            : '';
        const date = sig.publishedAt ? new Date(sig.publishedAt).toISOString().slice(0, 10) : '—';
        lines.push(`- [${sig.type}] ${sig.title}${score} — ${date}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a full 3-layer Markdown report from a StrategyTraceReport.
 * Layers are separated by `\n---\n\n`.
 */
export function renderTraceReport(report: StrategyTraceReport): string {
  const sections: string[] = [];

  // Layer 1 — Summary table
  sections.push(renderSummaryTable(report));

  const contextErrors = renderContextBuildErrors(report);
  if (contextErrors) {
    sections.push(contextErrors);
  }

  // Layer 2 — Per-strategy breakdown
  const breakdown = renderPerStrategySection(report);
  if (breakdown) {
    sections.push(breakdown);
  }

  // Layer 3 — Portfolio context appendix
  sections.push(renderPortfolioContextAppendix(report.portfolioContext));

  return sections.join('\n\n---\n\n');
}

/**
 * Render a terminal-friendly summary (Layer 1 only + fired triggers list).
 */
export function renderSummaryOnly(report: StrategyTraceReport): string {
  const lines: string[] = [renderSummaryTable(report)];

  if (report.summary.firedList.length > 0) {
    lines.push('');
    lines.push('### Fired Triggers');
    lines.push('');
    for (const fired of report.summary.firedList) {
      lines.push(`- **${fired.strategy}** → ${fired.ticker} (${fired.strength})`);
    }
  }

  return lines.join('\n');
}
