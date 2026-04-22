/**
 * Supply-chain map — per-ticker 2-hop graph of suppliers, customers, subsidiaries,
 * geographic footprint, and concentration flags. Built from Jintel's
 * `subsidiaries`, `concentration`, and `relationships` sub-graphs.
 *
 * Phase A: raw graph capture only (no LLM synthesis).
 * - `narrative` and `synthesizedBy` are null.
 * - `substitutability` is null on every edge.
 * - `criticality` is a deterministic composite score.
 *
 * Zod is the source of truth — types are derived via `z.infer`.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SupplyChainRelationshipSchema = z.enum([
  'SUPPLIER',
  'MANUFACTURER',
  'PARTNER',
  'DISTRIBUTOR',
  'LICENSOR',
  'JOINT_VENTURE',
]);
export type SupplyChainRelationship = z.infer<typeof SupplyChainRelationshipSchema>;

export const SubstitutabilitySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type Substitutability = z.infer<typeof SubstitutabilitySchema>;

/**
 * `JINTEL_DIRECT`: copied from a Jintel RelationshipEdge (sourced).
 * `LLM_INFERRED`: synthesized by a later LLM phase from context (Phase B).
 * Consumers weight trust accordingly.
 */
export const EdgeOriginSchema = z.enum(['JINTEL_DIRECT', 'LLM_INFERRED']);
export type EdgeOrigin = z.infer<typeof EdgeOriginSchema>;

export const ConcentrationDimensionSchema = z.enum(['PRODUCT', 'SEGMENT', 'GEOGRAPHY', 'CUSTOMER']);
export type ConcentrationDimension = z.infer<typeof ConcentrationDimensionSchema>;

// ---------------------------------------------------------------------------
// Evidence — structured provenance copied from Jintel's RelationshipEdge.source.
// Never free-text from the LLM.
// ---------------------------------------------------------------------------

export const EvidenceSchema = z.object({
  connector: z.string().min(1),
  url: z.string().url().nullable(),
  ref: z.string().nullable(),
  asOf: z.string().nullable(),
  contextQuote: z.string().nullable(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export const UpstreamEdgeSchema = z.object({
  counterpartyName: z.string().min(1),
  counterpartyTicker: z.string().min(1).nullable(),
  counterpartyCik: z.string().min(1).nullable(),
  relationship: SupplyChainRelationshipSchema,
  edgeOrigin: EdgeOriginSchema,
  /**
   * 0..1 — how load-bearing this counterparty is.
   * Phase A: min-max normalized composite of (valueUsd, sharePct, confidence).
   */
  criticality: z.number().min(0).max(1),
  /** LLM-assessed in Phase B; `null` in Phase A raw maps. */
  substitutability: SubstitutabilitySchema.nullable(),
  evidence: z.array(EvidenceSchema).min(1),
  /** Country (ISO-2) where this counterparty's critical capacity sits, if known. */
  originCountry: z.string().length(2).nullable(),
});
export type UpstreamEdge = z.infer<typeof UpstreamEdgeSchema>;

export const DownstreamEdgeSchema = z.object({
  counterpartyName: z.string().min(1),
  counterpartyTicker: z.string().min(1).nullable(),
  edgeOrigin: EdgeOriginSchema,
  /**
   * Jintel's `RelationshipEdge.sharePct` is 0..1 (share of revenue).
   * We preserve that scale here — consumers multiply by 100 for display.
   */
  sharePct: z.number().min(0).max(1).nullable(),
  valueUsd: z.number().min(0).nullable(),
  evidence: z.array(EvidenceSchema).min(1),
});
export type DownstreamEdge = z.infer<typeof DownstreamEdgeSchema>;

// ---------------------------------------------------------------------------
// Footprint + concentration
// ---------------------------------------------------------------------------

export const GeographicFootprintEntrySchema = z.object({
  iso2: z.string().length(2),
  country: z.string().min(1),
  /** 0..1 — currently count-normalized across subsidiaries + geography components. */
  criticality: z.number().min(0).max(1),
  entities: z.array(z.string().min(1)),
});
export type GeographicFootprintEntry = z.infer<typeof GeographicFootprintEntrySchema>;

/**
 * Derived concentration flag — populated deterministically from Jintel's
 * `concentration` sub-graph, not invented by the LLM.
 */
export const ConcentrationFlagSchema = z.object({
  dimension: ConcentrationDimensionSchema,
  hhi: z.number().min(0).max(10_000),
  /** Human-readable summary built from components, e.g. "Top-3 customers = 62% of revenue". */
  label: z.string().min(1),
});
export type ConcentrationFlag = z.infer<typeof ConcentrationFlagSchema>;

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

export const SupplyChainSourceSchema = z.object({
  connector: z.string().min(1),
  asOf: z.string().nullable(),
  ref: z.string().nullable(),
});
export type SupplyChainSource = z.infer<typeof SupplyChainSourceSchema>;

export const ProviderModelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});
export type ProviderModel = z.infer<typeof ProviderModelSchema>;

// ---------------------------------------------------------------------------
// Progressive expansion — user-driven exploration from a single node.
// Each expansion is grounded in Jintel relationship edges; the LLM classifies
// + ranks + labels. It never invents counterparties.
// ---------------------------------------------------------------------------

export const SupplyChainDirectionSchema = z.enum([
  'UPSTREAM_SUPPLIERS',
  'DOWNSTREAM_CUSTOMERS',
  'COUNTRY_EXPOSURE',
  'SECTOR_PEERS',
  'CONTRACT_MANUFACTURERS',
]);
export type SupplyChainDirection = z.infer<typeof SupplyChainDirectionSchema>;

/**
 * An expanded node. Must correspond to a real Jintel entity reference
 * (ticker or CIK). Never synthesized from thin air.
 */
export const SupplyChainExpansionNodeSchema = z.object({
  /** Stable node id — `ticker:<TICKER>` or `cik:<CIK>` or for countries `country:<ISO2>`. */
  id: z.string().min(1),
  label: z.string().min(1),
  ticker: z.string().min(1).nullable(),
  cik: z.string().min(1).nullable(),
  /** What the LLM classified this node as in the context of the direction. */
  nodeKind: z.enum(['COUNTERPARTY', 'COUNTRY', 'PEER']),
  /** ISO-2 when nodeKind === COUNTRY; best-effort when known for counterparties. */
  countryCode: z.string().length(2).nullable(),
  /** 0..1 — LLM-assigned rank within the expansion set. Stable across re-runs. */
  rank: z.number().min(0).max(1),
});
export type SupplyChainExpansionNode = z.infer<typeof SupplyChainExpansionNodeSchema>;

export const SupplyChainExpansionEdgeSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  relationship: SupplyChainRelationshipSchema,
  /** LLM-assigned short label — e.g. "contract foundry", "fiscal agent". */
  label: z.string().min(1),
  edgeOrigin: EdgeOriginSchema,
  /** 0..1 — LLM-assigned criticality for this edge. Never defaults to 0/1 unless supportable. */
  criticality: z.number().min(0).max(1),
  evidence: z.array(EvidenceSchema).min(1),
});
export type SupplyChainExpansionEdge = z.infer<typeof SupplyChainExpansionEdgeSchema>;

export const SupplyChainExpansionSchema = z.object({
  sourceNodeId: z.string().min(1),
  direction: SupplyChainDirectionSchema,
  requestedTicker: z.string().min(1),
  nodes: z.array(SupplyChainExpansionNodeSchema),
  edges: z.array(SupplyChainExpansionEdgeSchema),
  /** 1-2 sentence explanation the LLM produced for the expansion. Null when the LLM pass was skipped. */
  reasoning: z.string().nullable(),
  expandedAt: z.string().min(1),
  /** When this cached expansion should be considered stale (expandedAt + TTL). */
  staleAfter: z.string().min(1),
  synthesizedBy: ProviderModelSchema.nullable(),
});
export type SupplyChainExpansion = z.infer<typeof SupplyChainExpansionSchema>;

export const SupplyChainMapSchema = z.object({
  ticker: z.string().min(1),
  entityName: z.string().min(1),
  upstream: z.array(UpstreamEdgeSchema),
  downstream: z.array(DownstreamEdgeSchema),
  geographicFootprint: z.array(GeographicFootprintEntrySchema),
  concentrationRisks: z.array(ConcentrationFlagSchema),
  /** 2-3 sentence Phase-B LLM narrative. `null` in Phase A raw maps. */
  narrative: z.string().nullable(),
  /** When the map was built locally (ISO 8601). */
  asOf: z.string().min(1),
  /** Max `source.asOf` across every edge used — effective freshness of the map's data. */
  dataAsOf: z.string().nullable(),
  /** When this local build should be considered stale (asOf + TTL). */
  staleAfter: z.string().min(1),
  /** Jintel source refs used — enables provenance + future filing-based invalidation. */
  sources: z.array(SupplyChainSourceSchema),
  /** null in Phase A (no synthesis); populated in Phase B. */
  synthesizedBy: ProviderModelSchema.nullable(),
});
export type SupplyChainMap = z.infer<typeof SupplyChainMapSchema>;
