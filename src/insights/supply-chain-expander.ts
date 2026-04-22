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

  // 1. Resolve the source node to a Jintel entity + fetch relationships.
  const entity = await resolveEntity(deps.jintelClient, args.sourceNodeId, args.requestedTicker);
  if (!entity) {
    logger.warn('Expansion source entity did not resolve — returning empty', {
      sourceNodeId: args.sourceNodeId,
      requestedTicker: args.requestedTicker,
    });
    return emptyExpansion(args, direction, cacheKey);
  }

  // 2. Build deterministic candidate pool from Jintel. The LLM will rank within
  //    this set — never outside it.
  const candidates = buildCandidates(entity, direction);
  if (candidates.length === 0) {
    return emptyExpansion(args, direction, cacheKey);
  }

  // 3. Run the Opus classify/rank/label pass.
  const llmResult = await runExpansionLlm(deps.providerRouter, {
    sourceNodeId: args.sourceNodeId,
    requestedTicker: args.requestedTicker,
    direction,
    sourceEntityName: entity.name,
    candidates,
  });

  // 4. Map ranked output back to grounded nodes/edges. Drop anything that
  //    doesn't resolve to a Jintel-backed candidate (anti-hallucination).
  const candidateById = new Map(candidates.map((c) => [c.id, c] as const));
  const retained = llmResult?.ranked ?? [];

  const nodes: SupplyChainExpansionNode[] = [];
  const edges: SupplyChainExpansionEdge[] = [];
  const rankWindow = Math.max(retained.length, 1);

  retained.forEach((rankedItem, idx) => {
    const candidate = candidateById.get(rankedItem.id);
    if (!candidate) {
      // LLM hallucinated an id — drop silently, log at debug.
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

  const expandedAt = new Date().toISOString();
  const expansion: SupplyChainExpansion = {
    sourceNodeId: args.sourceNodeId,
    direction,
    requestedTicker: args.requestedTicker,
    nodes,
    edges,
    reasoning: llmResult?.reasoning ?? null,
    expandedAt,
    staleAfter: new Date(Date.parse(expandedAt) + STALE_AFTER_MS).toISOString(),
    synthesizedBy: llmResult ? { provider: OPUS_PROVIDER_ID, model: OPUS_MODEL_ID } : null,
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
