/**
 * Jintel type re-exports.
 *
 * Prior to @yojinhq/jintel-client@0.6.0, the package's Entity type didn't
 * include technicals, news, research, or sentiment. This file used to define
 * ExtendedEntity and ExtendedEnrichmentField to bridge the gap.
 *
 * Now that 0.6.0 ships all fields natively, this file simply re-exports the
 * upstream types for any remaining internal consumers.
 */

export type {
  Entity,
  EnrichmentField,
  FamaFrenchSeries,
  FactorDataPoint,
  HackerNewsStory,
  InstitutionalHolding,
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

// Types for planned jintel-client fields (financials, executives, redditComments).
// Defined locally until the client ships these as first-class enrichment fields.

export interface FinancialStatement {
  periodEnding: string;
  periodType?: string;
  totalRevenue?: number | null;
  grossProfit?: number | null;
  operatingIncome?: number | null;
  ebitda?: number | null;
  netIncome?: number | null;
  dilutedEps?: number | null;
  freeCashFlow?: number | null;
  operatingCashFlow?: number | null;
  totalDebt?: number | null;
  cashAndEquivalents?: number | null;
  totalEquity?: number | null;
}

export interface FinancialStatements {
  income: FinancialStatement[];
  balanceSheet: FinancialStatement[];
  cashFlow: FinancialStatement[];
}

export interface KeyExecutive {
  name: string;
  title: string;
  pay?: number | null;
  age?: number | null;
}

export interface RedditComment {
  id: string;
  subreddit: string;
  body: string;
  score: number;
  date?: string | null;
  parentId?: string;
}
