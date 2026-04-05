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
  PredictionMarket,
  PriceEvent,
  PriceEventType,
  ShortInterestReport,
  Social,
  SocialSentiment,
  TechnicalIndicators,
  USMarketStatus,
} from '@yojinhq/jintel-client';
