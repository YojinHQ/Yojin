// Hooks — the primary import for components
export {
  usePortfolio,
  useRefreshPositions,
  useAddManualPosition,
  useEditPosition,
  useRemovePosition,
  useRiskReport,
  useAlerts,
  useCreateAlert,
  useDismissAlert,
  useOnAlert,
  useQuote,
  useSearchSymbols,
  useNews,
  useOnPriceMove,
  useWatchlist,
  useAddToWatchlist,
  useRemoveFromWatchlist,
} from './hooks/index.js';

// Types — for components that need to type props or local state
export type {
  ManualPositionInput,
  Position,
  PortfolioSnapshot,
  PortfolioHistoryPoint,
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
  WatchlistEntry,
  WatchlistResult,
  SymbolSearchResult,
} from './types.js';

export { KNOWN_PLATFORMS, isKnownPlatform } from './types.js';

// Documents — for advanced use (manual client.query, testing)
export {
  PORTFOLIO_QUERY,
  RISK_REPORT_QUERY,
  ALERTS_QUERY,
  QUOTE_QUERY,
  SEARCH_SYMBOLS_QUERY,
  NEWS_QUERY,
  REFRESH_POSITIONS_MUTATION,
  ADD_MANUAL_POSITION_MUTATION,
  EDIT_POSITION_MUTATION,
  REMOVE_POSITION_MUTATION,
  CREATE_ALERT_MUTATION,
  DISMISS_ALERT_MUTATION,
  ON_ALERT_SUBSCRIPTION,
  ON_PORTFOLIO_UPDATE_SUBSCRIPTION,
  ON_PRICE_MOVE_SUBSCRIPTION,
} from './documents.js';
