/**
 * Signal module — barrel export.
 */

export {
  // Enums
  SignalTypeSchema,
  SourceTypeSchema,
  LinkTypeSchema,

  // Data source
  SignalDataSourceSchema,

  // Asset
  AssetSchema,

  // Signal ↔ Asset link
  SignalAssetLinkSchema,

  // Core signal
  SignalSchema,

  // Portfolio scoring
  PortfolioRelevanceScoreSchema,

  // Index (in-memory dedup + scoring)
  SignalIndexEntrySchema,
  SignalIndexSchema,
} from './types.js';

export type {
  SignalType,
  SourceType,
  LinkType,
  SignalDataSource,
  Asset,
  SignalAssetLink,
  Signal,
  PortfolioRelevanceScore,
  SignalIndexEntry,
  SignalIndex,
} from './types.js';
