import type { SignalMemoryStore } from './memory-store.js';
import type {
  Grade,
  LlmProvider,
  MemoryAgentRole,
  MemoryEntry,
  PriceOutcome,
  PriceProvider,
  ReflectionResult,
  ReflectionSweepResult,
} from './types.js';
import { getLogger } from '../logging/index.js';
import type { PiiRedactor } from '../trust/pii/types.js';

const log = getLogger().sub('reflection-engine');

const BULLISH = /\b(bullish|buy|long|upside|positive|growth|rally)\b/i;
const BEARISH = /\b(bearish|sell|short|downside|negative|decline|drop)\b/i;

const REFLECTION_SYSTEM_PROMPT = `You are reviewing a past financial analysis. Given the original situation, recommendation, and actual outcome, provide a concise lesson in 2-3 sentences:
1. What did the analysis get right or wrong?
2. What signal or factor was missed or overweighted?
3. What should this agent do differently in a similar future situation?
Be specific and actionable. Reference the actual market data provided.`;

interface ReflectionEngineOptions {
  providerRouter: LlmProvider;
  memoryStores: Map<MemoryAgentRole, SignalMemoryStore>;
  priceProvider: PriceProvider;
  piiRedactor: PiiRedactor;
  /** Model to use for lesson generation (default: provider's default). */
  model?: string;
}

export class ReflectionEngine {
  private readonly provider: LlmProvider;
  private readonly stores: Map<MemoryAgentRole, SignalMemoryStore>;
  private readonly priceProvider: PriceProvider;
  private readonly piiRedactor: PiiRedactor;
  private readonly model: string;

  constructor(options: ReflectionEngineOptions) {
    this.provider = options.providerRouter;
    this.stores = options.memoryStores;
    this.priceProvider = options.priceProvider;
    this.piiRedactor = options.piiRedactor;
    this.model = options.model ?? 'claude-sonnet-4-6';
  }

  async reflectOnEntry(entry: MemoryEntry): Promise<ReflectionResult> {
    // Already reflected — no-op, returns success per spec
    if (entry.reflectedAt !== null) {
      return { success: true };
    }

    // Step 1: Fetch price outcome
    // V1: uses first ticker only. Multi-ticker correlation is out of scope (see spec).
    let price: PriceOutcome;
    try {
      price = await this.priceProvider(entry.tickers[0], new Date(entry.createdAt));
    } catch (err) {
      log.warn('Price unavailable for reflection', { entryId: entry.id, ticker: entry.tickers[0], error: err });
      return { success: false, reason: 'price_unavailable', entryId: entry.id };
    }

    // Step 2: Deterministic grading
    const grade = this.grade(entry.recommendation, price.returnPct);

    // Step 3: LLM lesson generation
    let lesson: string;
    try {
      const response = await this.provider.completeWithTools({
        model: this.model,
        system: REFLECTION_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `## Original Analysis\nSituation: ${entry.situation}\nRecommendation: ${entry.recommendation}\nConfidence: ${entry.confidence}\n\n## Actual Outcome\nReturn: ${price.returnPct.toFixed(1)}% (${price.priceAtAnalysis.toFixed(2)} → ${price.priceNow.toFixed(2)})\nPeriod high: ${price.highInPeriod.toFixed(2)}, low: ${price.lowInPeriod.toFixed(2)}\nGrade: ${grade}`,
          },
        ],
      });
      lesson = response.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text ?? '')
        .join('');

      if (!lesson.trim()) {
        log.warn('LLM returned empty lesson for reflection', { entryId: entry.id });
        return { success: false, reason: 'llm_error', entryId: entry.id };
      }
    } catch (err) {
      log.warn('LLM call failed during reflection', { entryId: entry.id, error: err });
      return { success: false, reason: 'llm_error', entryId: entry.id };
    }

    // Step 4: Build outcome text and apply PII redaction
    const outcome = `${entry.tickers[0]} returned ${price.returnPct.toFixed(1)}% (${price.priceAtAnalysis.toFixed(2)} → ${price.priceNow.toFixed(2)}). Period range: ${price.lowInPeriod.toFixed(2)}-${price.highInPeriod.toFixed(2)}.`;

    const redacted = {
      outcome: this.redactText(outcome),
      lesson: this.redactText(lesson),
    };

    // Step 5: Update memory atomically
    const store = this.stores.get(entry.agentRole);
    if (!store) throw new Error(`No memory store for role: ${entry.agentRole}`);

    const reflectResult = await store.reflect(entry.id, {
      outcome: redacted.outcome,
      lesson: redacted.lesson,
      actualReturn: price.returnPct,
      grade,
    });

    if (!reflectResult.success) {
      log.error('Failed to persist reflection', { entryId: entry.id, storeError: reflectResult.error });
      return { success: false, reason: 'store_error', entryId: entry.id };
    }

    log.info('Reflection complete', { entryId: entry.id, grade, returnPct: price.returnPct });
    return { success: true };
  }

  async runSweep(options?: { olderThanDays?: number }): Promise<ReflectionSweepResult> {
    const days = options?.olderThanDays ?? 7;
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - days);

    const result: ReflectionSweepResult = { reflected: 0, skipped: 0, errors: 0 };

    for (const [role, store] of this.stores) {
      const unreflected = await store.findUnreflected({ olderThan: threshold });
      log.info('Sweep found unreflected entries', { role, count: unreflected.length });

      for (const entry of unreflected) {
        const r = await this.reflectOnEntry(entry);
        if (r.success) {
          result.reflected++;
        } else if (r.reason === 'price_unavailable') {
          result.skipped++;
        } else {
          result.errors++;
        }
      }
    }

    log.info('Reflection sweep complete', { ...result });
    return result;
  }

  async reflectOnRevisit(agentRole: MemoryAgentRole, ticker: string): Promise<MemoryEntry[]> {
    const store = this.stores.get(agentRole);
    if (!store) return [];

    const unreflected = await store.findUnreflected({ ticker });
    const reflected: MemoryEntry[] = [];

    for (const entry of unreflected) {
      const r = await this.reflectOnEntry(entry);
      if (r.success) {
        const updated = store.get(entry.id);
        if (updated) reflected.push(updated);
      }
    }

    return reflected;
  }

  /** Magnitude threshold — returns below this % are "way off" for a directional call. */
  private static readonly MAGNITUDE_THRESHOLD = 1.0;

  private grade(recommendation: string, returnPct: number): Grade {
    const isBullish = BULLISH.test(recommendation);
    const isBearish = BEARISH.test(recommendation);
    const absReturn = Math.abs(returnPct);

    // Direction right but magnitude negligible — partially correct
    if (isBullish && returnPct > 0 && absReturn < ReflectionEngine.MAGNITUDE_THRESHOLD) return 'PARTIALLY_CORRECT';
    if (isBearish && returnPct < 0 && absReturn < ReflectionEngine.MAGNITUDE_THRESHOLD) return 'PARTIALLY_CORRECT';

    // Direction correct with meaningful magnitude
    if (isBullish && returnPct > 0) return 'CORRECT';
    if (isBearish && returnPct < 0) return 'CORRECT';

    // Direction wrong
    if (isBullish && returnPct < 0) return 'INCORRECT';
    if (isBearish && returnPct > 0) return 'INCORRECT';

    // Ambiguous recommendation (neither bullish nor bearish keywords)
    return 'PARTIALLY_CORRECT';
  }

  private redactText(text: string): string {
    const { data } = this.piiRedactor.redact({ text });
    return data.text as string;
  }
}
