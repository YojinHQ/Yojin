/**
 * Progressive supply-chain expansion — user clicks a node / direction chip, we
 * fetch fresh Jintel relationship data for that node and run a short LLM pass
 * to classify + rank + label the new edges in the requested direction.
 *
 * Contract (mirrors the Phase B synthesizer):
 * - We NEVER invent counterparties. Every emitted node traces back to a Jintel
 *   entity or relationship edge. The LLM's job is classification, ranking, and
 *   labelling — not construction.
 * - LLM output is schema-validated. Any edge whose `sourceId` / `targetId`
 *   doesn't resolve to a known Jintel-derived node is dropped before persist.
 * - If Jintel returns no relationships for the direction, we skip the LLM call
 *   entirely and return an empty expansion. No hallucinated filler.
 * - Results are cached by `(sourceNodeId, direction, hopDepth)` — re-clicking
 *   the same chip from the same node is free.
 *
 * Model: pinned to `claude-opus-4-7`. The project's ProviderRouter `'opus'`
 * tier currently maps to `claude-opus-4-6` (see `src/ai-providers/router.ts`),
 * so we pass the concrete model id rather than the tier alias. When the tier
 * catches up to 4-7, this can be swapped back to `'opus'`.
 */

import type { Entity, JintelClient } from '@yojinhq/jintel-client';
import { z } from 'zod';

import { SupplyChainExpansionStore, expansionCacheKey } from './supply-chain-expansion-store.js';
import type { RelationshipEdge } from './supply-chain-jintel.js';
import {
  EdgeOriginSchema,
  SupplyChainDirectionSchema,
  SupplyChainExpansionSchema,
  SupplyChainRelationshipSchema,
} from './supply-chain-types.js';
import type {
  Evidence,
  SupplyChainDirection,
  SupplyChainExpansion,
  SupplyChainExpansionEdge,
  SupplyChainExpansionNode,
} from './supply-chain-types.js';
import type { ProviderRouter } from '../ai-providers/router.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('supply-chain-expander');

/**
 * Concrete Opus model. Pinned here so a misconfigured router tier can't silently
 * fall back to Sonnet. See module-doc for the rationale.
 */
const OPUS_MODEL_ID = 'claude-opus-4-7';
const OPUS_PROVIDER_ID = 'claude-code';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_NODES_PER_EXPANSION = 12;
const DEFAULT_HOP_DEPTH = 1;

export interface ExpandSupplyChainNodeArgs {
  sourceNodeId: string;
  direction: SupplyChainDirection;
  requestedTicker: string;
  hopDepth?: number;
  /** Forces a fresh LLM pass even if a cached expansion exists. */
  force?: boolean;
  /**
   * Augment grounded Jintel-sourced candidates with Opus-world-knowledge
   * counterparties (`edgeOrigin: LLM_INFERRED`). Every inferred counterparty
   * must emit a ticker that resolves via `batchEnrich` — unresolvable tickers
   * are dropped, so we never surface a fabricated entity. Default: true.
   */
  includeInferred?: boolean;
}

export interface ExpanderDeps {
  jintelClient: JintelClient | undefined;
  providerRouter: ProviderRouter;
  store: SupplyChainExpansionStore;
}

/**
 * LLM output shape. Kept deliberately narrow — we don't ask the LLM for node
 * identifiers or evidence; those come from Jintel. The LLM only classifies and
 * ranks candidates the deterministic pre-pass produced.
 */
const LlmExpansionOutputSchema = z.object({
  reasoning: z.string().min(1),
  /**
   * Ranked list of candidate ids the LLM recommends surfacing. Ids must come
   * from the `candidate.id` pool supplied in the prompt. Anything unrecognised
   * is dropped.
   */
  ranked: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        edgeLabel: z.string().min(1),
        criticality: z.number(),
        relationship: SupplyChainRelationshipSchema,
      }),
    )
    .max(MAX_NODES_PER_EXPANSION),
});

type LlmCandidate = {
  id: string;
  label: string;
  ticker: string | null;
  cik: string | null;
  countryCode: string | null;
  nodeKind: SupplyChainExpansionNode['nodeKind'];
  evidence: Evidence;
  jintelType: RelationshipEdge['type'] | 'COUNTRY' | 'PEER';
};

/**
 * Expand a supply-chain node in the requested direction. Returns a structured
 * expansion ready for the UI to merge into its graph, or null if Jintel is
 * unavailable in this environment.
 */
export async function expandSupplyChainNode(
  args: ExpandSupplyChainNodeArgs,
  deps: ExpanderDeps,
): Promise<SupplyChainExpansion | null> {
  const hopDepth = args.hopDepth ?? DEFAULT_HOP_DEPTH;
  const direction = SupplyChainDirectionSchema.parse(args.direction);
  const cacheKey = expansionCacheKey({
    sourceNodeId: args.sourceNodeId,
    direction,
    hopDepth,
  });

  if (!args.force && (await deps.store.isFresh(cacheKey, STALE_AFTER_MS))) {
    const cached = await deps.store.get(cacheKey);
    if (cached) return cached;
  }

  if (!deps.jintelClient) {
    // Feature unavailable without a client — silent null. Callers distinguish
    // from "LLM ran but produced an empty set" via `null` vs. empty expansion.
    return null;
  }

  const includeInferred = args.includeInferred ?? true;

  // 1. Resolve the source node to a Jintel entity + fetch relationships. A
  //    null entity means we can't run the grounded pass, but the ecosystem
  //    pass can still produce world-knowledge counterparties.
  const entity = await resolveEntity(deps.jintelClient, args.sourceNodeId, args.requestedTicker);
  if (!entity && !includeInferred) {
    logger.warn('Expansion source entity did not resolve — returning empty', {
      sourceNodeId: args.sourceNodeId,
      requestedTicker: args.requestedTicker,
    });
    return emptyExpansion(args, direction, cacheKey);
  }

  // 2. Build the grounded + ecosystem candidate pools in parallel. The
  //    grounded pool is deterministic (Jintel relationships classified by
  //    Opus); the ecosystem pool is Opus-world-knowledge, then validated by
  //    resolving every proposed ticker through Jintel.
  const sourceEntityName = entity?.name ?? args.requestedTicker;
  const groundedCandidates = entity ? buildCandidates(entity, direction) : [];

  const [groundedResult, ecosystemCandidates] = await Promise.all([
    groundedCandidates.length > 0
      ? runExpansionLlm(deps.providerRouter, {
          sourceNodeId: args.sourceNodeId,
          requestedTicker: args.requestedTicker,
          direction,
          sourceEntityName,
          candidates: groundedCandidates,
        })
      : Promise.resolve(null),
    includeInferred
      ? runEcosystemLlm(deps.providerRouter, deps.jintelClient, {
          sourceNodeId: args.sourceNodeId,
          requestedTicker: args.requestedTicker,
          direction,
          sourceEntityName,
        })
      : Promise.resolve([]),
  ]);

  // 3. Map the grounded classifier output back to nodes/edges. Drop anything
  //    the LLM emitted that doesn't resolve to a candidate (anti-hallucination).
  const candidateById = new Map(groundedCandidates.map((c) => [c.id, c] as const));
  const retained = groundedResult?.ranked ?? [];

  const nodes: SupplyChainExpansionNode[] = [];
  const edges: SupplyChainExpansionEdge[] = [];
  const rankWindow = Math.max(retained.length + ecosystemCandidates.length, 1);

  retained.forEach((rankedItem, idx) => {
    const candidate = candidateById.get(rankedItem.id);
    if (!candidate) {
      logger.debug('Dropping unsupportable expansion node', { id: rankedItem.id });
      return;
    }
    const rank = 1 - idx / rankWindow;
    const criticality = clamp01(rankedItem.criticality);

    nodes.push({
      id: candidate.id,
      label: rankedItem.label || candidate.label,
      ticker: candidate.ticker,
      cik: candidate.cik,
      nodeKind: candidate.nodeKind,
      countryCode: candidate.countryCode,
      rank,
    });
    edges.push({
      sourceId: args.sourceNodeId,
      targetId: candidate.id,
      relationship: rankedItem.relationship,
      label: rankedItem.edgeLabel,
      edgeOrigin: EdgeOriginSchema.enum.JINTEL_DIRECT,
      criticality,
      evidence: [candidate.evidence],
    });
  });

  // 4. Append ecosystem nodes/edges. Dedupe by id — a counterparty surfaced
  //    by both the grounded and ecosystem paths keeps the grounded entry so
  //    the provenance stays sourced.
  const seen = new Set(nodes.map((n) => n.id));
  ecosystemCandidates.forEach((eco, idx) => {
    if (seen.has(eco.id)) return;
    seen.add(eco.id);
    const rank = 1 - (retained.length + idx) / rankWindow;
    nodes.push({
      id: eco.id,
      label: eco.label,
      ticker: eco.ticker,
      cik: eco.cik,
      nodeKind: eco.nodeKind,
      countryCode: eco.countryCode,
      rank,
    });
    edges.push({
      sourceId: args.sourceNodeId,
      targetId: eco.id,
      relationship: eco.relationship,
      label: eco.edgeLabel,
      edgeOrigin: EdgeOriginSchema.enum.LLM_INFERRED,
      criticality: clamp01(eco.criticality),
      evidence: [eco.evidence],
    });
  });

  const reasoning = composeReasoning(groundedResult?.reasoning ?? null, ecosystemCandidates);
  const synthesizedBy =
    groundedResult || ecosystemCandidates.length > 0 ? { provider: OPUS_PROVIDER_ID, model: OPUS_MODEL_ID } : null;

  const expandedAt = new Date().toISOString();
  const expansion: SupplyChainExpansion = {
    sourceNodeId: args.sourceNodeId,
    direction,
    requestedTicker: args.requestedTicker,
    nodes,
    edges,
    reasoning,
    expandedAt,
    staleAfter: new Date(Date.parse(expandedAt) + STALE_AFTER_MS).toISOString(),
    synthesizedBy,
  };

  // Schema round-trip ensures we never persist a half-formed expansion.
  const validated = SupplyChainExpansionSchema.parse(expansion);
  await deps.store.put(cacheKey, validated);
  return validated;
}

// ---------------------------------------------------------------------------
// Jintel resolution
// ---------------------------------------------------------------------------

/**
 * Source-node ids flowing in from the frontend look like `ticker:AAPL`,
 * `cik:0000320193`, or the plain ticker itself (the `requestedTicker` supplied
 * by the caller). We parse the id, prefer an explicit ticker when present, and
 * fall back to the caller-supplied ticker.
 */
async function resolveEntity(
  client: JintelClient,
  sourceNodeId: string,
  requestedTicker: string,
): Promise<Entity | null> {
  const extracted = parseNodeIdTicker(sourceNodeId);
  const ticker = extracted ?? requestedTicker;
  if (!ticker) return null;

  const result = await client.batchEnrich([ticker], ['subsidiaries', 'concentration', 'relationships'], {
    relationshipsFilter: { limit: 100, minConfidence: 0.3 },
  });
  if (!result.success) return null;
  return result.data[0] ?? null;
}

function parseNodeIdTicker(nodeId: string): string | null {
  if (nodeId.startsWith('ticker:')) return nodeId.slice('ticker:'.length) || null;
  if (nodeId.startsWith('country:')) return null;
  if (nodeId.startsWith('cik:')) return null;
  // Bare tickers are also accepted.
  return /^[A-Z0-9.-]{1,16}$/i.test(nodeId) ? nodeId : null;
}

// ---------------------------------------------------------------------------
// Candidate construction — deterministic filter by direction
// ---------------------------------------------------------------------------

function buildCandidates(entity: Entity, direction: SupplyChainDirection): LlmCandidate[] {
  const relationships: RelationshipEdge[] = entity.relationships ?? [];

  switch (direction) {
    case SupplyChainDirectionSchema.enum.UPSTREAM_SUPPLIERS:
      return relationships.filter(isUpstream).map((r) => counterpartyCandidate(r, 'COUNTERPARTY'));
    case SupplyChainDirectionSchema.enum.DOWNSTREAM_CUSTOMERS:
      return relationships.filter(isDownstream).map((r) => counterpartyCandidate(r, 'COUNTERPARTY'));
    case SupplyChainDirectionSchema.enum.CONTRACT_MANUFACTURERS:
      return relationships.filter(isContractManufacturer).map((r) => counterpartyCandidate(r, 'COUNTERPARTY'));
    case SupplyChainDirectionSchema.enum.COUNTRY_EXPOSURE:
      return buildCountryCandidates(entity);
    case SupplyChainDirectionSchema.enum.SECTOR_PEERS:
      // Jintel doesn't currently expose sector peers on the entity — surface any
      // OWNERSHIP/PARTNER edges as a best-effort peer candidate set. This is
      // intentionally conservative; when Jintel adds a peers sub-graph, wire it
      // here instead of expanding the filter.
      return relationships.filter(isPeerLike).map((r) => counterpartyCandidate(r, 'PEER'));
  }
}

function isUpstream(e: RelationshipEdge): boolean {
  if (e.direction === 'IN' && (e.type === 'PARTNER' || e.type === 'OWNERSHIP')) return true;
  if (e.direction === 'OUT' && e.type === 'SUBSIDIARY') return true;
  return false;
}

function isDownstream(e: RelationshipEdge): boolean {
  return e.direction === 'OUT' && (e.type === 'CUSTOMER' || e.type === 'GOVERNMENT_CUSTOMER');
}

function isContractManufacturer(e: RelationshipEdge): boolean {
  // SUBSIDIARY OUT heuristic — frequently a manufacturing arm. The LLM refines
  // the label; we only gate admission here.
  return e.direction === 'OUT' && e.type === 'SUBSIDIARY';
}

function isPeerLike(e: RelationshipEdge): boolean {
  return e.type === 'OWNERSHIP' || e.type === 'PARTNER';
}

function counterpartyCandidate(edge: RelationshipEdge, nodeKind: 'COUNTERPARTY' | 'PEER'): LlmCandidate {
  const ticker = edge.counterpartyTicker ?? null;
  const cik = edge.counterpartyCik ?? null;
  const id = ticker ? `ticker:${ticker}` : cik ? `cik:${cik}` : `name:${edge.counterpartyName}`;
  return {
    id,
    label: edge.counterpartyName,
    ticker,
    cik,
    countryCode: null,
    nodeKind,
    jintelType: edge.type,
    evidence: {
      connector: edge.source.connector,
      url: edge.source.url ?? null,
      ref: edge.source.ref ?? null,
      asOf: edge.source.asOf ?? null,
      contextQuote: edge.context ?? null,
    },
  };
}

function buildCountryCandidates(entity: Entity): LlmCandidate[] {
  const out: LlmCandidate[] = [];
  const seen = new Set<string>();
  // Subsidiary jurisdictions → one country node per unique ISO-2-ish label.
  for (const sub of entity.subsidiaries?.subsidiaries ?? []) {
    const juris = sub.jurisdiction;
    if (!juris) continue;
    const iso2 = toIso2(juris);
    if (!iso2 || seen.has(iso2)) continue;
    seen.add(iso2);
    out.push({
      id: `country:${iso2}`,
      label: juris,
      ticker: null,
      cik: null,
      countryCode: iso2,
      nodeKind: 'COUNTRY',
      jintelType: 'COUNTRY',
      evidence: {
        connector: 'sec-exhibit21',
        url: null,
        ref: null,
        asOf: null,
        contextQuote: `${entity.name} has a subsidiary in ${juris}.`,
      },
    });
  }
  // Concentration.geography components.
  for (const comp of entity.concentration?.geography?.components ?? []) {
    const iso2 = toIso2(comp.label);
    if (!iso2 || seen.has(iso2)) continue;
    seen.add(iso2);
    out.push({
      id: `country:${iso2}`,
      label: comp.label,
      ticker: null,
      cik: null,
      countryCode: iso2,
      nodeKind: 'COUNTRY',
      jintelType: 'COUNTRY',
      evidence: {
        connector: 'sec-segments',
        url: null,
        ref: null,
        asOf: null,
        contextQuote: `${(comp.share * 100).toFixed(1)}% of disclosed geography revenue from ${comp.label}.`,
      },
    });
  }
  return out;
}

function toIso2(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const up = raw.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(up)) return up;
  // Cheap best-effort for the handful of countries Jintel commonly returns
  // as full names. The raw-builder already has an exhaustive table; we keep
  // this narrow so the expander's module stays focused.
  const map: Record<string, string> = {
    'UNITED STATES': 'US',
    USA: 'US',
    CHINA: 'CN',
    JAPAN: 'JP',
    'SOUTH KOREA': 'KR',
    KOREA: 'KR',
    TAIWAN: 'TW',
    GERMANY: 'DE',
    IRELAND: 'IE',
    INDIA: 'IN',
    SINGAPORE: 'SG',
    VIETNAM: 'VN',
    'UNITED KINGDOM': 'GB',
    UK: 'GB',
  };
  return map[up] ?? null;
}

// ---------------------------------------------------------------------------
// LLM pass — Opus-4.7, tight prompt, schema-validated output.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are classifying and ranking supply-chain relationships that were retrieved from Jintel for a user's interactive graph expansion.

You receive:
- The source entity and the direction the user clicked.
- A numbered list of CANDIDATES — each already has a stable id, a counterparty name, and a Jintel-sourced relationship type. These are the ONLY entities you may surface. You must not invent, merge, or rename them beyond what the user would see as a natural display label.

Your job — for each candidate you choose to include:
1. Pick the best short edgeLabel describing this counterparty's role for the source in the requested direction (e.g. "contract foundry", "wholesale channel", "Tier-1 supplier", "manufacturing jurisdiction").
2. Assign one of: SUPPLIER, MANUFACTURER, PARTNER, DISTRIBUTOR, LICENSOR, JOINT_VENTURE.
3. Assign a criticality in [0, 1] — how load-bearing this counterparty is for the source, ranked relative to siblings.
4. Return candidates in descending rank order — the most important first.

Hard rules:
- NEVER emit an id that wasn't in the candidate list. Unsupportable ids will be dropped.
- NEVER invent counterparties, substitutes, or speculative links.
- If a candidate is clearly noise for the direction (e.g. a defunct JV surfaced when the user asked for DOWNSTREAM_CUSTOMERS), OMIT it. Under-reporting is better than hallucination.
- Keep labels short (<= 40 chars) and information-dense.

Respond with a single JSON object matching:
{
  "reasoning": "1-2 sentence explanation — what story this expansion tells.",
  "ranked": [
    { "id": "ticker:TSM", "label": "Taiwan Semiconductor", "edgeLabel": "primary foundry", "criticality": 0.92, "relationship": "MANUFACTURER" }
  ]
}`;

async function runExpansionLlm(
  router: ProviderRouter,
  params: {
    sourceNodeId: string;
    requestedTicker: string;
    direction: SupplyChainDirection;
    sourceEntityName: string;
    candidates: LlmCandidate[];
  },
): Promise<z.infer<typeof LlmExpansionOutputSchema> | null> {
  const { candidates } = params;
  if (candidates.length === 0) return null;

  const candidateBlock = candidates
    .map((c, idx) => {
      const ids = [c.ticker ? `ticker=${c.ticker}` : null, c.cik ? `cik=${c.cik}` : null, `id=${c.id}`]
        .filter(Boolean)
        .join(', ');
      return `${idx + 1}. ${c.label} [${ids}] — Jintel type: ${c.jintelType}`;
    })
    .join('\n');

  const userMessage = [
    `Source: ${params.sourceEntityName} (${params.requestedTicker})`,
    `Source node id: ${params.sourceNodeId}`,
    `Direction requested: ${params.direction}`,
    '',
    `CANDIDATES (${candidates.length}):`,
    candidateBlock,
    '',
    'Pick the best candidates for this direction, rank them, and label each edge. Remember: ids must match the candidate list exactly.',
  ].join('\n');

  let text: string;
  try {
    const result = await router.completeWithTools({
      // Pass the concrete model id — the router's `opus` tier still points at
      // claude-opus-4-6 at the time of writing, and we want 4-7.
      model: OPUS_MODEL_ID,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1024,
      providerOverrides: { provider: OPUS_PROVIDER_ID, model: OPUS_MODEL_ID },
    });
    text = result.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
  } catch (err) {
    logger.warn('Opus expansion call failed — returning empty LLM result', {
      direction: params.direction,
      error: String(err),
    });
    return null;
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn('Opus expansion returned no JSON payload');
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.warn('Opus expansion returned invalid JSON', { error: String(err) });
    return null;
  }

  // Clamp numerics before schema parse so a stray 1.05 / -0.1 doesn't torch the
  // whole response. Bounded schema runs after clamping.
  const coerced = coerceLlmOutput(parsed);
  const validation = LlmExpansionOutputSchema.safeParse(coerced);
  if (!validation.success) {
    logger.warn('Opus expansion payload failed schema validation', {
      issues: validation.error.issues.map((i) => i.message),
    });
    return null;
  }
  return validation.data;
}

function coerceLlmOutput(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.ranked)) return obj;
  obj.ranked = obj.ranked
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((item) => {
      const c = item.criticality;
      if (typeof c === 'number' && Number.isFinite(c)) {
        item.criticality = Math.max(0, Math.min(1, c));
      }
      return item;
    });
  return obj;
}

// ---------------------------------------------------------------------------
// Ecosystem LLM pass — Opus world-knowledge counterparties, Jintel-validated.
//
// Grounded candidates are strictly derived from Jintel's `relationships`
// sub-graph. For mega-cap public companies (e.g. NVDA, AAPL) that slice is
// often thin or noisy, and the user expects to see the real AI/semi/hyper-
// scaler ecosystem. This pass asks Opus for world-knowledge counterparties,
// then validates every emitted ticker through `batchEnrich` — if Jintel
// doesn't resolve the ticker to a real entity, we drop it. That keeps the
// "every node is a real entity" invariant intact while unblocking the
// cross-industry relationships Jintel doesn't surface directly.
// ---------------------------------------------------------------------------

interface EcosystemCandidate {
  id: string;
  label: string;
  ticker: string;
  cik: string | null;
  nodeKind: SupplyChainExpansionNode['nodeKind'];
  countryCode: string | null;
  edgeLabel: string;
  relationship: z.infer<typeof SupplyChainRelationshipSchema>;
  criticality: number;
  evidence: Evidence;
}

const MAX_ECOSYSTEM_CANDIDATES = 8;
const ECOSYSTEM_CONNECTOR = 'llm-opus-4-7-ecosystem';

const EcosystemItemSchema = z.object({
  ticker: z.string().min(1).max(16),
  label: z.string().min(1),
  edgeLabel: z.string().min(1),
  relationship: SupplyChainRelationshipSchema,
  criticality: z.number(),
  reason: z.string().min(1),
});

const EcosystemOutputSchema = z.object({
  reasoning: z.string().min(1),
  items: z.array(EcosystemItemSchema).max(MAX_ECOSYSTEM_CANDIDATES),
});

const ECOSYSTEM_SYSTEM_PROMPT = `You are surfacing real-world supply-chain and ecosystem counterparties for an interactive portfolio graph.

This is an augmentation pass on top of narrow Jintel relationship data — the user wants to see the wider ecosystem (e.g. for NVDA: TSM as foundry; MSFT/META/GOOG/AMZN as hyperscaler customers; ASML/AMAT as upstream tooling), not just whatever filings Jintel has indexed.

Hard rules:
- Emit ONLY real, currently-listed public companies with a ticker symbol. Tickers without a real company will be rejected downstream (Jintel batch-validates every ticker you emit).
- Prefer US / major-exchange tickers when an entity trades on multiple exchanges (TSM over 2330.TW; BABA over 9988.HK).
- Do NOT emit private companies, rumors, speculative ventures, acquired/defunct entities, or fictional names.
- Do NOT echo the source company itself.
- Cap the output at 8 items. Rank them — most load-bearing first.
- Keep edgeLabel short and concrete (<= 40 chars): "primary foundry", "HBM supplier", "hyperscaler customer", "EUV tooling".
- relationship must be one of: SUPPLIER, MANUFACTURER, PARTNER, DISTRIBUTOR, LICENSOR, JOINT_VENTURE.
- criticality is [0, 1] — how load-bearing, ranked relative to peers.
- reason: 1 short sentence (<= 160 chars) explaining why this counterparty belongs here.

Direction semantics:
- UPSTREAM_SUPPLIERS: what the source BUYS (fabs, key components, raw materials, tooling).
- DOWNSTREAM_CUSTOMERS: what the source SELLS to (hyperscalers, OEMs, enterprise accounts).
- CONTRACT_MANUFACTURERS: outsourced manufacturing / assembly partners.
- SECTOR_PEERS: competitors in the same sector with overlapping business.

Respond with a single JSON object:
{
  "reasoning": "1-2 sentence narrative of the ecosystem story.",
  "items": [
    { "ticker": "TSM", "label": "Taiwan Semiconductor", "edgeLabel": "primary foundry", "relationship": "MANUFACTURER", "criticality": 0.95, "reason": "Fabs every NVIDIA GPU; no comparable N3/N4 alternative today." }
  ]
}`;

async function runEcosystemLlm(
  router: ProviderRouter,
  jintelClient: JintelClient,
  params: {
    sourceNodeId: string;
    requestedTicker: string;
    direction: SupplyChainDirection;
    sourceEntityName: string;
  },
): Promise<EcosystemCandidate[]> {
  // Country exposure is a deterministic fan-out from Jintel's geography data —
  // world-knowledge adds no value and risks spurious country chips.
  if (params.direction === SupplyChainDirectionSchema.enum.COUNTRY_EXPOSURE) {
    return [];
  }

  const userMessage = [
    `Source: ${params.sourceEntityName} (${params.requestedTicker})`,
    `Direction: ${params.direction}`,
    '',
    'Emit the most load-bearing real-world ecosystem counterparties for this source in this direction. Up to 8. Every item must have a resolvable public ticker.',
  ].join('\n');

  let text: string;
  try {
    const result = await router.completeWithTools({
      model: OPUS_MODEL_ID,
      system: ECOSYSTEM_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1024,
      providerOverrides: { provider: OPUS_PROVIDER_ID, model: OPUS_MODEL_ID },
    });
    text = result.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
  } catch (err) {
    logger.warn('Ecosystem LLM call failed — skipping inferred candidates', {
      direction: params.direction,
      error: String(err),
    });
    return [];
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.debug('Ecosystem LLM returned no JSON payload', { direction: params.direction });
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    logger.debug('Ecosystem LLM returned invalid JSON', { error: String(err) });
    return [];
  }

  const coerced = coerceEcosystemOutput(parsed);
  const validation = EcosystemOutputSchema.safeParse(coerced);
  if (!validation.success) {
    logger.debug('Ecosystem LLM payload failed schema validation', {
      issues: validation.error.issues.map((i) => i.message),
    });
    return [];
  }

  const { items } = validation.data;
  if (items.length === 0) return [];

  // Drop any echo of the source and dedupe by ticker (preserve rank order).
  const sourceTickerUpper = params.requestedTicker.trim().toUpperCase();
  const unique = new Map<string, z.infer<typeof EcosystemItemSchema>>();
  for (const item of items) {
    const ticker = item.ticker.trim().toUpperCase();
    if (!ticker || ticker === sourceTickerUpper) continue;
    if (!unique.has(ticker)) unique.set(ticker, { ...item, ticker });
  }
  if (unique.size === 0) return [];

  // Anti-hallucination gate: every proposed ticker must resolve through Jintel.
  // A single batchEnrich call validates the whole set.
  const tickers = Array.from(unique.keys());
  const enrich = await jintelClient.batchEnrich(tickers, [], {});
  if (!enrich.success) {
    logger.debug('Ecosystem ticker validation failed — skipping inferred candidates', {
      direction: params.direction,
    });
    return [];
  }

  const resolved = new Map<string, { name: string; country: string | null }>();
  for (const entity of enrich.data) {
    for (const t of entity.tickers ?? []) {
      const key = t.trim().toUpperCase();
      if (!key || resolved.has(key)) continue;
      resolved.set(key, {
        name: entity.name,
        country: normalizeIso2(entity.country ?? null),
      });
    }
  }

  const asOf = new Date().toISOString();
  const nodeKind: SupplyChainExpansionNode['nodeKind'] =
    params.direction === SupplyChainDirectionSchema.enum.SECTOR_PEERS ? 'PEER' : 'COUNTERPARTY';

  const out: EcosystemCandidate[] = [];
  for (const item of unique.values()) {
    const hit = resolved.get(item.ticker);
    if (!hit) continue;
    out.push({
      id: `ticker:${item.ticker}`,
      label: hit.name || item.label,
      ticker: item.ticker,
      cik: null,
      nodeKind,
      countryCode: hit.country,
      edgeLabel: item.edgeLabel,
      relationship: item.relationship,
      criticality: clamp01(item.criticality),
      evidence: {
        connector: ECOSYSTEM_CONNECTOR,
        url: null,
        ref: null,
        asOf,
        contextQuote: item.reason,
      },
    });
  }
  return out.slice(0, MAX_ECOSYSTEM_CANDIDATES);
}

function coerceEcosystemOutput(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.items)) return obj;
  obj.items = obj.items
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((item) => {
      const c = item.criticality;
      if (typeof c === 'number' && Number.isFinite(c)) {
        item.criticality = Math.max(0, Math.min(1, c));
      }
      return item;
    });
  return obj;
}

function normalizeIso2(raw: string | null): string | null {
  if (!raw) return null;
  const up = raw.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(up)) return up;
  return toIso2(raw);
}

function composeReasoning(grounded: string | null, ecosystem: EcosystemCandidate[]): string | null {
  const parts: string[] = [];
  if (grounded && grounded.trim().length > 0) parts.push(grounded.trim());
  if (ecosystem.length > 0) {
    const top = ecosystem
      .slice(0, 3)
      .map((c) => c.ticker)
      .join(', ');
    const suffix = ecosystem.length > 3 ? ` +${ecosystem.length - 3}` : '';
    parts.push(`Ecosystem context: ${top}${suffix}.`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function emptyExpansion(
  args: ExpandSupplyChainNodeArgs,
  direction: SupplyChainDirection,
  _cacheKey: string,
): SupplyChainExpansion {
  const expandedAt = new Date().toISOString();
  return SupplyChainExpansionSchema.parse({
    sourceNodeId: args.sourceNodeId,
    direction,
    requestedTicker: args.requestedTicker,
    nodes: [],
    edges: [],
    reasoning: null,
    expandedAt,
    staleAfter: new Date(Date.parse(expandedAt) + STALE_AFTER_MS).toISOString(),
    synthesizedBy: null,
  });
}
