import { z } from 'zod';

// ── Enums ──────────────────────────────────────────────────────────────────

export const EntityTypeSchema = z.enum(['COMPANY', 'PERSON', 'CRYPTO', 'COMMODITY', 'INDEX']);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const SeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type Severity = z.infer<typeof SeveritySchema>;

export const RiskSignalTypeSchema = z.enum(['SANCTIONS', 'LITIGATION', 'REGULATORY_ACTION', 'ADVERSE_MEDIA', 'PEP']);
export type RiskSignalType = z.infer<typeof RiskSignalTypeSchema>;

export const FilingTypeSchema = z.enum(['FILING_10K', 'FILING_10Q', 'FILING_8K', 'ANNUAL_REPORT', 'OTHER']);
export type FilingType = z.infer<typeof FilingTypeSchema>;

// ── Data Schemas ───────────────────────────────────────────────────────────

export const MarketQuoteSchema = z.object({
  ticker: z.string(),
  price: z.number(),
  open: z.number().nullable().optional(),
  high: z.number().nullable().optional(),
  low: z.number().nullable().optional(),
  previousClose: z.number().nullable().optional(),
  change: z.number(),
  changePercent: z.number(),
  volume: z.number(),
  marketCap: z.number().nullable().optional(),
  timestamp: z.string(),
  source: z.string(),
});
export type MarketQuote = z.infer<typeof MarketQuoteSchema>;

export const FundamentalsSchema = z.object({
  marketCap: z.number().nullable().optional(),
  revenue: z.number().nullable().optional(),
  netIncome: z.number().nullable().optional(),
  eps: z.number().nullable().optional(),
  peRatio: z.number().nullable().optional(),
  dividendYield: z.number().nullable().optional(),
  beta: z.number().nullable().optional(),
  fiftyTwoWeekHigh: z.number().nullable().optional(),
  fiftyTwoWeekLow: z.number().nullable().optional(),
  debtToEquity: z.number().nullable().optional(),
  sector: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  source: z.string(),
});
export type Fundamentals = z.infer<typeof FundamentalsSchema>;

export const MarketDataSchema = z.object({
  quote: MarketQuoteSchema.nullable().optional(),
  fundamentals: FundamentalsSchema.nullable().optional(),
});
export type MarketData = z.infer<typeof MarketDataSchema>;

export const NewsArticleSchema = z.object({
  title: z.string(),
  url: z.string(),
  source: z.string(),
  publishedAt: z.string(),
  snippet: z.string().nullable().optional(),
  sentiment: z.string().nullable().optional(),
});
export type NewsArticle = z.infer<typeof NewsArticleSchema>;

export const RiskSignalSchema = z.object({
  type: RiskSignalTypeSchema,
  severity: SeveritySchema,
  description: z.string(),
  source: z.string(),
  date: z.string().nullable().optional(),
});
export type RiskSignal = z.infer<typeof RiskSignalSchema>;

export const RiskProfileSchema = z.object({
  overallScore: z.number(),
  signals: z.array(RiskSignalSchema),
  sanctionsHits: z.number(),
  adverseMediaHits: z.number(),
  regulatoryActions: z.number(),
});
export type RiskProfile = z.infer<typeof RiskProfileSchema>;

export const SanctionsMatchSchema = z.object({
  listName: z.string(),
  matchedName: z.string(),
  score: z.number(),
  details: z.string().nullable().optional(),
});
export type SanctionsMatch = z.infer<typeof SanctionsMatchSchema>;

export const FilingSchema = z.object({
  type: FilingTypeSchema,
  date: z.string(),
  url: z.string(),
  description: z.string().nullable().optional(),
});
export type Filing = z.infer<typeof FilingSchema>;

export const RegulatoryDataSchema = z.object({
  sanctions: z.array(SanctionsMatchSchema),
  filings: z.array(FilingSchema),
});
export type RegulatoryData = z.infer<typeof RegulatoryDataSchema>;

export const OfficerSchema = z.object({
  name: z.string(),
  role: z.string(),
  appointedDate: z.string().nullable().optional(),
});
export type Officer = z.infer<typeof OfficerSchema>;

export const CorporateDataSchema = z.object({
  legalName: z.string().nullable().optional(),
  jurisdiction: z.string().nullable().optional(),
  incorporationDate: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  officers: z.array(OfficerSchema),
  registeredAddress: z.string().nullable().optional(),
});
export type CorporateData = z.infer<typeof CorporateDataSchema>;

export const WebResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string().nullable().optional(),
  source: z.string(),
  publishedAt: z.string().nullable().optional(),
});
export type WebResult = z.infer<typeof WebResultSchema>;

export const EntitySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: EntityTypeSchema,
  tickers: z.array(z.string()).nullable().optional(),
  domain: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  market: MarketDataSchema.nullable().optional(),
  news: z.array(NewsArticleSchema).nullable().optional(),
  risk: RiskProfileSchema.nullable().optional(),
  regulatory: RegulatoryDataSchema.nullable().optional(),
  corporate: CorporateDataSchema.nullable().optional(),
});
export type Entity = z.infer<typeof EntitySchema>;

// ── Response Wrappers ──────────────────────────────────────────────────────

export const GraphQLErrorSchema = z.object({
  message: z.string(),
  extensions: z
    .object({
      code: z.string(),
    })
    .nullable()
    .optional(),
});
export type GraphQLError = z.infer<typeof GraphQLErrorSchema>;

export const GraphQLResponseSchema = z.object({
  data: z.unknown().nullable(),
  errors: z.array(GraphQLErrorSchema).optional(),
  extensions: z
    .object({
      meta: z
        .object({
          sources: z.array(z.string()).optional(),
          latency_ms: z.number().optional(),
          cost: z.number().optional(),
          cached: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});
export type GraphQLResponse = z.infer<typeof GraphQLResponseSchema>;

// ── Config & Field Selection ───────────────────────────────────────────────

export interface JintelClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
  debug?: boolean;
}

export type EnrichmentField = 'market' | 'news' | 'risk' | 'regulatory' | 'corporate';

export const ALL_ENRICHMENT_FIELDS: EnrichmentField[] = ['market', 'news', 'risk', 'regulatory', 'corporate'];
