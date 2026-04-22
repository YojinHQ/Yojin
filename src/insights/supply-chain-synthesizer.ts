/**
 * Phase B — LLM synthesis over a raw supply-chain map.
 *
 * The raw map (from `buildRawSupplyChainMap`) is deterministic and sourced.
 * The LLM's job is strictly refinement: a short narrative, per-upstream-edge
 * substitutability + origin country. It MAY NOT:
 *   - invent new edges or counterparties
 *   - change criticality, sharePct, valueUsd, evidence, or concentration flags
 *   - write free-text citations (evidence stays verbatim from Jintel)
 *
 * The output is merged onto the raw map by counterparty key (ticker || name)
 * and re-validated through `SupplyChainMapSchema` before return.
 *
 * One Sonnet call per rebuild, with prompt caching on the static system prefix.
 * Scheduler is expected to batch rebuilds within the 5-minute ephemeral-cache
 * window to realise the savings (see plan doc).
 */
import { z } from 'zod';

import {
  type ProviderModel,
  type Substitutability,
  SubstitutabilitySchema,
  type SupplyChainMap,
  SupplyChainMapSchema,
  type UpstreamEdge,
} from './supply-chain-types.js';
import type { ProviderRouter } from '../ai-providers/router.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('supply-chain-synthesizer');

const SYNTHESIS_MODEL_TIER = 'sonnet';

/** The Anthropic provider ID used when `synthesizedBy` is populated. */
const DEFAULT_PROVIDER_ID = 'claude-code';

// ---------------------------------------------------------------------------
// LLM output schema — strictly the fields the model is allowed to emit.
// ---------------------------------------------------------------------------

const LlmUpstreamEnrichmentSchema = z.object({
  /** `counterpartyTicker || counterpartyName` — must match an edge in the raw map. */
  matchKey: z.string().min(1),
  substitutability: SubstitutabilitySchema.nullable(),
  /** ISO-3166 alpha-2. `null` when the model is not confident. */
  originCountry: z
    .string()
    .regex(/^[A-Z]{2}$/, 'originCountry must be 2 upper-case letters (ISO-3166 alpha-2)')
    .nullable(),
});

const LlmSynthesisSchema = z.object({
  narrative: z.string().min(1).max(2000),
  upstreamEnrichments: z.array(LlmUpstreamEnrichmentSchema),
});
type LlmSynthesis = z.infer<typeof LlmSynthesisSchema>;

// ---------------------------------------------------------------------------
// System prompt — static, cacheable. Explains the task, the output contract,
// and shows a few worked examples. Keep stable — changes invalidate the cache.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a supply-chain analyst who refines a pre-computed, sourced graph.

INPUT (in the user turn, as JSON):
- ticker, entityName
- rawMap: the authoritative graph already built from SEC filings and Jintel connectors.
  It contains: upstream[] (suppliers/manufacturers/partners), downstream[] (customers),
  geographicFootprint[], concentrationRisks[]. Every edge has structured Evidence
  copied verbatim from its source filing. Treat rawMap as ground truth.
- hop0, hop1: the underlying Jintel entities with their own subsidiaries/relationships.
  Use them ONLY to judge substitutability and origin country. Do not mine them for
  new edges.

YOUR JOB is to emit exactly two things:

1) \`narrative\`: 2–3 plain-English sentences that describe the ticker's supply-chain
   position. Name the most load-bearing counterparties, call out geographic
   concentration, and flag any single-point-of-failure risk. Do not hedge, do not
   speculate about events not reflected in the data.

2) \`upstreamEnrichments[]\`: one entry per upstream edge you want to annotate.
   Each entry carries:
   - \`matchKey\`: \`counterpartyTicker\` if present on the raw edge, else
     \`counterpartyName\` (verbatim). Must match an existing edge — entries that do
     not match any raw edge will be discarded.
   - \`substitutability\`: HIGH / MEDIUM / LOW / null.
     - HIGH  — many interchangeable suppliers (commodity chemicals, generic IT services).
     - MEDIUM — a few qualified alternatives, switching takes months (contract manufacturers, software).
     - LOW  — effectively irreplaceable on a < 12-month horizon (TSMC 3nm, single-source ASICs, sole-source drugs).
     - null — you cannot tell from the provided context.
   - \`originCountry\`: ISO-3166 alpha-2 (e.g. "TW", "KR", "US"). Where the critical
     capacity physically sits, not the counterparty's HQ. null when not inferrable.

HARD RULES:
- Never invent an edge, counterparty, or evidence string.
- Never emit a matchKey that does not exist in rawMap.upstream.
- Never change criticality, concentration flags, geography, or downstream entries.
- Output a single JSON object, no prose, no markdown fences.

OUTPUT SCHEMA (exactly this shape):
{
  "narrative": "string (2-3 sentences)",
  "upstreamEnrichments": [
    { "matchKey": "TSM|TSMC|...", "substitutability": "HIGH|MEDIUM|LOW|null", "originCountry": "TW|null" }
  ]
}

EXAMPLES

Example 1 — AAPL (hardware + Taiwan exposure)
Raw upstream includes TSMC (TSM), Samsung Electronics, Foxconn. Raw concentration flags
geography = top-3 ~91%.
Narrative: "Apple is structurally dependent on Taiwanese foundry capacity — TSMC is the
sole supplier for leading-edge iPhone SoCs with no drop-in alternative under a 12-month
horizon. Displays and memory concentrate in Korea (Samsung, SK Hynix) with more
substitutability, while final assembly leans on Foxconn facilities in China. A Taiwan
disruption is the tail risk the graph reflects."
Enrichments:
[
  { "matchKey": "TSM", "substitutability": "LOW", "originCountry": "TW" },
  { "matchKey": "Samsung Electronics", "substitutability": "MEDIUM", "originCountry": "KR" },
  { "matchKey": "Foxconn", "substitutability": "MEDIUM", "originCountry": "CN" }
]

Example 2 — LMT (US-gov concentrated)
Raw downstream dominated by US Department of Defense; upstream partners mostly US
subcontractors (RTX, NOC components). Concentration flags customer top-1 > 70%.
Narrative: "Lockheed Martin's revenue is structurally tied to a single buyer — the US
federal government — which is the binding counterparty concentration on the chart.
Upstream is a US-industrial-base partner network (Raytheon, Northrop subsystems) with
medium substitutability; the firm's exposure is political and fiscal rather than
geographic."
Enrichments:
[
  { "matchKey": "RTX", "substitutability": "MEDIUM", "originCountry": "US" },
  { "matchKey": "NOC", "substitutability": "MEDIUM", "originCountry": "US" }
]

Example 3 — PFE (clinical-trial partners)
Raw upstream is a long tail of clinical-trial collaborators (universities, CROs, smaller
biotechs). No single upstream edge crosses criticality 0.5 and concentration flags are
empty on upstream.
Narrative: "Pfizer's upstream graph is diffuse — a large portfolio of clinical-trial
partners and contract research organisations with no single load-bearing dependency.
Downstream is channel-diversified through wholesalers. The chart shows low
counterparty concentration and therefore limited supply-chain shock exposure."
Enrichments:
[
  { "matchKey": "IQVIA", "substitutability": "HIGH", "originCountry": "US" }
]

Return only the JSON object.`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SynthesizeArgs {
  providerRouter: ProviderRouter;
  rawMap: SupplyChainMap;
  /** Raw hop-0 Jintel entity — passed verbatim as JSON for context. */
  hop0: unknown;
  /** Raw hop-1 Jintel entities — passed verbatim as JSON for context. */
  hop1: unknown;
  /** Force a specific provider/model tier override (tests / dry-runs). */
  modelTier?: string;
  /** Timeout for the LLM call (default 30s). Rebuilds are batch / not user-blocking. */
  timeoutMs?: number;
}

/**
 * Runs one LLM synthesis pass over the raw map. On any failure (timeout, bad
 * JSON, schema violation, no upstream) the caller is expected to fall back to
 * the raw map — this function throws rather than returning a degraded result.
 */
export async function synthesizeSupplyChainMap(args: SynthesizeArgs): Promise<SupplyChainMap> {
  const { providerRouter, rawMap, hop0, hop1 } = args;
  const modelTier = args.modelTier ?? SYNTHESIS_MODEL_TIER;
  const timeoutMs = args.timeoutMs ?? 30_000;

  const userPayload = {
    ticker: rawMap.ticker,
    entityName: rawMap.entityName,
    rawMap: compactRawMapForPrompt(rawMap),
    hop0,
    hop1,
    currentDate: new Date().toISOString().slice(0, 10),
  };

  const start = Date.now();
  const result = await withTimeout(
    providerRouter.completeWithTools({
      model: modelTier,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
      maxTokens: 1500,
      cacheSystem: true,
    }),
    timeoutMs,
    `supply-chain synthesis exceeded ${timeoutMs}ms`,
  );

  const text = result.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  const llmOut = parseLlmJson(text);

  const synthesizedBy = resolveSynthesizedBy(providerRouter, modelTier);
  const merged = mergeEnrichments(rawMap, llmOut, synthesizedBy);

  const validated = SupplyChainMapSchema.parse(merged);
  logger.info('supply-chain synthesis complete', {
    ticker: rawMap.ticker,
    durationMs: Date.now() - start,
    enrichments: llmOut.upstreamEnrichments.length,
    narrativeChars: llmOut.narrative.length,
  });
  return validated;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * The raw map's `evidence` blocks can be large. For the LLM we only need the
 * counterparty identity and the Jintel-derived signals that drive its
 * reasoning (criticality, sharePct, connector names). Strip everything else.
 */
function compactRawMapForPrompt(map: SupplyChainMap): Record<string, unknown> {
  return {
    upstream: map.upstream.map((e) => ({
      counterpartyName: e.counterpartyName,
      counterpartyTicker: e.counterpartyTicker,
      relationship: e.relationship,
      criticality: Number(e.criticality.toFixed(3)),
      connectors: e.evidence.map((ev) => ev.connector),
    })),
    downstream: map.downstream.map((e) => ({
      counterpartyName: e.counterpartyName,
      counterpartyTicker: e.counterpartyTicker,
      sharePct: e.sharePct,
    })),
    geographicFootprint: map.geographicFootprint.map((g) => ({
      iso2: g.iso2,
      country: g.country,
      criticality: Number(g.criticality.toFixed(3)),
    })),
    concentrationRisks: map.concentrationRisks,
  };
}

function parseLlmJson(text: string): LlmSynthesis {
  if (!text) {
    throw new Error('supply-chain synthesis: empty response from LLM');
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('supply-chain synthesis: no JSON object found in response');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new Error(`supply-chain synthesis: invalid JSON — ${String(err)}`, { cause: err });
  }
  const normalized = normalizeLlmFields(parsed);
  return LlmSynthesisSchema.parse(normalized);
}

/**
 * Fix up common LLM shape quirks before Zod parsing:
 * - string "null" / "N/A" → real null on nullable fields
 * - substitutability / originCountry upper-cased
 * - drop enrichments missing a matchKey
 */
function normalizeLlmFields(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const obj = parsed as Record<string, unknown>;
  const enrichments = Array.isArray(obj.upstreamEnrichments) ? obj.upstreamEnrichments : [];
  const cleaned = enrichments
    .map((raw) => {
      if (!raw || typeof raw !== 'object') return null;
      const e = raw as Record<string, unknown>;
      const matchKey = typeof e.matchKey === 'string' ? e.matchKey.trim() : '';
      if (!matchKey) return null;
      return {
        matchKey,
        substitutability: coerceSubstitutability(e.substitutability),
        originCountry: coerceCountry(e.originCountry),
      };
    })
    .filter((e): e is { matchKey: string; substitutability: Substitutability | null; originCountry: string | null } =>
      Boolean(e),
    );
  return {
    narrative: typeof obj.narrative === 'string' ? obj.narrative.trim() : '',
    upstreamEnrichments: cleaned,
  };
}

function coerceSubstitutability(value: unknown): Substitutability | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  if (upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW') return upper;
  return null;
}

function coerceCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  return null;
}

function mergeEnrichments(raw: SupplyChainMap, llm: LlmSynthesis, synthesizedBy: ProviderModel): SupplyChainMap {
  const byKey = new Map<string, { substitutability: Substitutability | null; originCountry: string | null }>();
  for (const enr of llm.upstreamEnrichments) {
    byKey.set(enr.matchKey.toUpperCase(), {
      substitutability: enr.substitutability,
      originCountry: enr.originCountry,
    });
  }

  const upstream: UpstreamEdge[] = raw.upstream.map((edge) => {
    const keys = [edge.counterpartyTicker, edge.counterpartyName].filter(
      (k): k is string => typeof k === 'string' && k.length > 0,
    );
    let match: { substitutability: Substitutability | null; originCountry: string | null } | undefined;
    for (const key of keys) {
      match = byKey.get(key.toUpperCase());
      if (match) break;
    }
    if (!match) return edge;
    return {
      ...edge,
      substitutability: match.substitutability ?? edge.substitutability,
      originCountry: match.originCountry ?? edge.originCountry,
    };
  });

  return {
    ...raw,
    upstream,
    narrative: llm.narrative.trim(),
    synthesizedBy,
  };
}

function resolveSynthesizedBy(router: ProviderRouter, modelTier: string): ProviderModel {
  try {
    const { provider, model } = router.resolve({ model: modelTier });
    return { provider: provider.id, model };
  } catch {
    // Router couldn't resolve (e.g. no backend registered in a test). Fall
    // back to the tier name so the field is still well-formed.
    return { provider: DEFAULT_PROVIDER_ID, model: modelTier };
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
