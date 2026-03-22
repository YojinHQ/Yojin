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

// Archive
export { SignalArchive } from './archive.js';
export type { SignalArchiveOptions, SignalQueryFilter } from './archive.js';

// Ingestor
export { SignalIngestor } from './ingestor.js';
export type { IngestorOptions, IngestResult, RawSignalInput } from './ingestor.js';

// Ticker extraction
export { extractTickers } from './ticker-extractor.js';
export type { SymbolResolver } from './ticker-extractor.js';

// Agent tools
export { createSignalTools } from './tools.js';
export type { SignalToolsOptions } from './tools.js';
