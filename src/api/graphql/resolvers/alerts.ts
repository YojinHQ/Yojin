/**
 * Alerts resolvers — queries for triggered alerts.
 *
 * Returns mock alert data representing typical Yojin alerts: price moves,
 * concentration warnings, and sentiment shifts. Will be replaced with real
 * alert engine output once wired into YojinContext.
 */

const mockAlerts = [
  {
    id: 'alert-001',
    type: 'price-move',
    severity: 'info',
    message: 'BTC up 1.89% today, approaching 52-week high',
    symbol: 'BTC',
    triggeredAt: new Date(Date.now() - 1800_000).toISOString(),
    acknowledged: false,
  },
  {
    id: 'alert-002',
    type: 'concentration',
    severity: 'warning',
    message: 'Technology sector concentration at 53.1% — consider diversifying',
    symbol: null,
    triggeredAt: new Date(Date.now() - 7200_000).toISOString(),
    acknowledged: false,
  },
  {
    id: 'alert-003',
    type: 'sentiment-shift',
    severity: 'info',
    message: 'ETH sentiment shifted from bullish to neutral',
    symbol: 'ETH',
    triggeredAt: new Date(Date.now() - 14400_000).toISOString(),
    acknowledged: true,
  },
  {
    id: 'alert-004',
    type: 'correlation',
    severity: 'warning',
    message: 'AAPL-SPY correlation at 0.92 — high overlap with index exposure',
    symbol: 'AAPL',
    triggeredAt: new Date(Date.now() - 86400_000).toISOString(),
    acknowledged: true,
  },
];

export const alertsResolvers = {
  Query: {
    alerts: () => mockAlerts,
  },
};
