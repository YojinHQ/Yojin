/**
 * CostTracker — tracks LLM API costs per model, per run, and per session.
 *
 * Maintains per-model pricing tables for Anthropic and OpenAI models,
 * accumulates usage across iterations, and enforces budget caps.
 *
 * Inspired by Claude Code's cost-tracker: static pricing tables,
 * per-session persistence, and hard-stop budget enforcement.
 */

import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('cost-tracker');

// ---------------------------------------------------------------------------
// Pricing (USD per million tokens)
// ---------------------------------------------------------------------------

export interface ModelPricing {
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok?: number;
  cacheWritePerMtok?: number;
}

/**
 * Known model pricing as of 2025-Q2.
 * Key = model ID prefix (matched via startsWith).
 */
const MODEL_PRICING: ReadonlyMap<string, ModelPricing> = new Map([
  // Anthropic
  ['claude-opus-4', { inputPerMtok: 15, outputPerMtok: 75, cacheReadPerMtok: 1.5, cacheWritePerMtok: 18.75 }],
  ['claude-sonnet-4', { inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 }],
  ['claude-haiku-4', { inputPerMtok: 0.8, outputPerMtok: 4, cacheReadPerMtok: 0.08, cacheWritePerMtok: 1 }],
  // Legacy (still used in some configs)
  ['claude-3-5-sonnet', { inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 }],
  ['claude-3-5-haiku', { inputPerMtok: 0.8, outputPerMtok: 4, cacheReadPerMtok: 0.08, cacheWritePerMtok: 1 }],
  // OpenAI (via Codex CLI)
  ['gpt-5.4', { inputPerMtok: 10, outputPerMtok: 40 }],
  ['gpt-5.4-mini', { inputPerMtok: 5, outputPerMtok: 20 }],
  ['gpt-5.3-codex', { inputPerMtok: 8, outputPerMtok: 32 }],
  ['gpt-5.2-codex', { inputPerMtok: 6, outputPerMtok: 24 }],
  ['gpt-5.2', { inputPerMtok: 5, outputPerMtok: 20 }],
  ['gpt-5.1-codex-max', { inputPerMtok: 4, outputPerMtok: 16 }],
  ['gpt-5.1-codex-mini', { inputPerMtok: 1.5, outputPerMtok: 6 }],
  // Legacy OpenAI
  ['gpt-4o', { inputPerMtok: 2.5, outputPerMtok: 10 }],
  ['gpt-4o-mini', { inputPerMtok: 0.15, outputPerMtok: 0.6 }],
  ['gpt-4-turbo', { inputPerMtok: 10, outputPerMtok: 30 }],
  ['o1', { inputPerMtok: 15, outputPerMtok: 60 }],
  ['o1-mini', { inputPerMtok: 3, outputPerMtok: 12 }],
  ['o3-mini', { inputPerMtok: 1.1, outputPerMtok: 4.4 }],
]);

/** Fallback pricing when model is unknown. Conservative (Sonnet-tier). */
const FALLBACK_PRICING: ModelPricing = { inputPerMtok: 3, outputPerMtok: 15 };

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ModelUsage {
  model: string;
  tokens: TokenUsage;
  costUsd: number;
  calls: number;
}

export interface CostSnapshot {
  totalCostUsd: number;
  byModel: Map<string, ModelUsage>;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

// ---------------------------------------------------------------------------
// CostTracker
// ---------------------------------------------------------------------------

export interface CostTrackerConfig {
  /** Max USD per agent loop run. When exceeded, the loop is told to stop. */
  maxRunBudgetUsd?: number;
}

export class CostTracker {
  private readonly config: CostTrackerConfig;
  private readonly byModel = new Map<string, ModelUsage>();
  private totalCostUsd = 0;
  private totalCalls = 0;

  constructor(config?: CostTrackerConfig) {
    this.config = config ?? {};
  }

  /**
   * Record token usage from an LLM call.
   * Returns the incremental cost in USD.
   */
  addUsage(model: string, usage: TokenUsage): number {
    const pricing = this.getPricing(model);
    const cost = this.calculateCost(usage, pricing);

    let entry = this.byModel.get(model);
    if (!entry) {
      entry = { model, tokens: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, calls: 0 };
      this.byModel.set(model, entry);
    }

    entry.tokens.inputTokens += usage.inputTokens;
    entry.tokens.outputTokens += usage.outputTokens;
    entry.tokens.cacheReadTokens = (entry.tokens.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0);
    entry.tokens.cacheWriteTokens = (entry.tokens.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
    entry.costUsd += cost;
    entry.calls++;

    this.totalCostUsd += cost;
    this.totalCalls++;

    logger.debug('Usage recorded', {
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: cost.toFixed(6),
      totalCostUsd: this.totalCostUsd.toFixed(6),
    });

    return cost;
  }

  /** Check if the run budget has been exceeded. */
  isOverBudget(): boolean {
    if (this.config.maxRunBudgetUsd && this.totalCostUsd >= this.config.maxRunBudgetUsd) {
      return true;
    }
    return false;
  }

  /** The configured per-run budget cap (undefined if no cap). */
  get maxRunBudgetUsd(): number | undefined {
    return this.config.maxRunBudgetUsd;
  }

  /** Get a snapshot of current costs. */
  snapshot(): CostSnapshot {
    let totalInput = 0;
    let totalOutput = 0;
    for (const entry of this.byModel.values()) {
      totalInput += entry.tokens.inputTokens;
      totalOutput += entry.tokens.outputTokens;
    }
    return {
      totalCostUsd: this.totalCostUsd,
      byModel: new Map(this.byModel),
      totalCalls: this.totalCalls,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
    };
  }

  /** Reset counters (e.g. at the start of a new run). */
  reset(): void {
    this.byModel.clear();
    this.totalCostUsd = 0;
    this.totalCalls = 0;
  }

  /** Format a human-readable cost summary. */
  formatSummary(): string {
    const snap = this.snapshot();
    const lines: string[] = [`Total: $${snap.totalCostUsd.toFixed(4)} (${snap.totalCalls} calls)`];
    for (const [model, usage] of snap.byModel) {
      lines.push(
        `  ${model}: $${usage.costUsd.toFixed(4)} (${usage.calls} calls, ` +
          `${usage.tokens.inputTokens} in / ${usage.tokens.outputTokens} out)`,
      );
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private getPricing(model: string): ModelPricing {
    // Pass 1: exact match
    for (const [key, pricing] of MODEL_PRICING) {
      if (model === key) return pricing;
    }
    // Pass 2: longest prefix wins (avoids gpt-4o matching before gpt-4o-mini)
    let best: ModelPricing | undefined;
    let bestLen = 0;
    for (const [key, pricing] of MODEL_PRICING) {
      if (model.startsWith(key) && key.length > bestLen) {
        best = pricing;
        bestLen = key.length;
      }
    }
    if (best) return best;
    logger.debug('Unknown model pricing, using fallback', { model });
    return FALLBACK_PRICING;
  }

  private calculateCost(usage: TokenUsage, pricing: ModelPricing): number {
    const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMtok;
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMtok;
    const cacheReadCost = usage.cacheReadTokens
      ? (usage.cacheReadTokens / 1_000_000) * (pricing.cacheReadPerMtok ?? pricing.inputPerMtok * 0.1)
      : 0;
    const cacheWriteCost = usage.cacheWriteTokens
      ? (usage.cacheWriteTokens / 1_000_000) * (pricing.cacheWritePerMtok ?? pricing.inputPerMtok * 1.25)
      : 0;
    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
  }
}
