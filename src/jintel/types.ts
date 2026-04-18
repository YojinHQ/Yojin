/**
 * Jintel type re-exports.
 *
 * Re-exports upstream types from @yojinhq/jintel-client for internal consumers.
 */

export type {
  Entity,
  EnrichmentField,
  FamaFrenchSeries,
  FactorDataPoint,
  FinancialStatements,
  HackerNewsStory,
  InstitutionalHolding,
  KeyExecutive,
  OwnershipBreakdown,
  PredictionMarket,
  PriceEvent,
  PriceEventType,
  ShortInterestReport,
  Social,
  SocialSentiment,
  TechnicalIndicators,
  TopHolder,
  USMarketStatus,
} from '@yojinhq/jintel-client';

// RedditComment is still yojin-internal — the client's Social sub-graph models
// Reddit comments inline on the post object, whereas we track them as a flat
// list for the signal pipeline.
export interface RedditComment {
  id: string;
  subreddit: string;
  body: string;
  score: number;
  date?: string | null;
  parentId?: string;
}
