// Hooks — the primary import for components
export {
  usePortfolio,
  usePositions,
  usePortfolioHistory,
  useEnrichedSnapshot,
  useRefreshPositions,
  useAddManualPosition,
  useRiskReport,
  useSectorExposure,
  useAlerts,
  useCreateAlert,
  useDismissAlert,
  useOnAlert,
  useQuote,
  useNews,
  useOnPriceMove,
} from './hooks/index.js';

// Types — for components that need to type props or local state
export type {
  ManualPositionInput,
  Position,
  PortfolioSnapshot,
  PortfolioHistoryPoint,
  EnrichedPosition,
  EnrichedSnapshot,
  SectorWeight,
  Concentration,
  CorrelationCluster,
  RiskReport,
  Alert,
  AlertRule,
  AlertRuleInput,
  Quote,
  Article,
  PriceEvent,
  AssetClass,
  KnownPlatform,
  Platform,
  AlertStatus,
  AlertRuleType,
  Direction,
} from './types.js';

export { KNOWN_PLATFORMS, isKnownPlatform } from './types.js';

// Documents — for advanced use (manual client.query, testing)
export {
  PORTFOLIO_QUERY,
  POSITIONS_QUERY,
  PORTFOLIO_HISTORY_QUERY,
  ENRICHED_SNAPSHOT_QUERY,
  RISK_REPORT_QUERY,
  SECTOR_EXPOSURE_QUERY,
  ALERTS_QUERY,
  QUOTE_QUERY,
  NEWS_QUERY,
  REFRESH_POSITIONS_MUTATION,
  ADD_MANUAL_POSITION_MUTATION,
  CREATE_ALERT_MUTATION,
  DISMISS_ALERT_MUTATION,
  ON_ALERT_SUBSCRIPTION,
  ON_PORTFOLIO_UPDATE_SUBSCRIPTION,
  ON_PRICE_MOVE_SUBSCRIPTION,
} from './documents.js';
