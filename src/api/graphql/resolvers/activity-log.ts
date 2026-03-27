/**
 * Activity log resolvers — activityLog query.
 *
 * Returns recent activity events. Currently backed by mock data;
 * call setEventLog() from the composition root to wire the real EventLog.
 */

import type { EventLog } from '../../../core/event-log.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActivityEventType = 'TRADE' | 'SYSTEM' | 'ACTION' | 'ALERT' | 'INSIGHT';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  message: string;
  timestamp: string;
  ticker?: string;
  metadata?: string;
}

// ---------------------------------------------------------------------------
// EventLog wiring (composition root calls setEventLog)
// ---------------------------------------------------------------------------

let eventLog: EventLog | null = null;

export function setEventLog(log: EventLog): void {
  eventLog = log;
}

// ---------------------------------------------------------------------------
// Mock data (used when EventLog is not wired)
// ---------------------------------------------------------------------------

function createMockEvents(): ActivityEvent[] {
  const now = Date.now();
  return [
    {
      id: 'evt-001',
      type: 'INSIGHT',
      message: 'New insight report generated for portfolio',
      timestamp: new Date(now - 2 * 60_000).toISOString(),
    },
    {
      id: 'evt-002',
      type: 'ALERT',
      message: 'AAPL approaching 52-week high',
      timestamp: new Date(now - 15 * 60_000).toISOString(),
      ticker: 'AAPL',
    },
    {
      id: 'evt-003',
      type: 'ACTION',
      message: 'Portfolio positions refreshed from Interactive Brokers',
      timestamp: new Date(now - 30 * 60_000).toISOString(),
    },
    {
      id: 'evt-004',
      type: 'SYSTEM',
      message: 'Signal curation pipeline completed — 12 signals processed',
      timestamp: new Date(now - 45 * 60_000).toISOString(),
    },
    {
      id: 'evt-005',
      type: 'TRADE',
      message: 'Buy order executed: 10 shares of NVDA at $875.30',
      timestamp: new Date(now - 60 * 60_000).toISOString(),
      ticker: 'NVDA',
    },
    {
      id: 'evt-006',
      type: 'INSIGHT',
      message: 'BTC sentiment shifted from neutral to bullish',
      timestamp: new Date(now - 90 * 60_000).toISOString(),
      ticker: 'BTC',
    },
    {
      id: 'evt-007',
      type: 'ALERT',
      message: 'Concentration warning: TSLA exceeds 25% of portfolio',
      timestamp: new Date(now - 2 * 3_600_000).toISOString(),
      ticker: 'TSLA',
    },
    {
      id: 'evt-008',
      type: 'SYSTEM',
      message: 'Morning briefing digest delivered',
      timestamp: new Date(now - 3 * 3_600_000).toISOString(),
    },
    {
      id: 'evt-009',
      type: 'ACTION',
      message: 'Watchlist updated: added MSFT, removed META',
      timestamp: new Date(now - 4 * 3_600_000).toISOString(),
    },
    {
      id: 'evt-010',
      type: 'TRADE',
      message: 'Sell order executed: 5 shares of AMZN at $185.20',
      timestamp: new Date(now - 5 * 3_600_000).toISOString(),
      ticker: 'AMZN',
    },
  ];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_TYPES = new Set<string>(['TRADE', 'SYSTEM', 'ACTION', 'ALERT', 'INSIGHT']);

function isActivityEventType(value: string): value is ActivityEventType {
  return VALID_TYPES.has(value);
}

function eventLogEntryToActivity(entry: {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}): ActivityEvent | null {
  const mappedType = entry.type.toUpperCase();
  if (!isActivityEventType(mappedType)) return null;

  return {
    id: entry.id,
    type: mappedType,
    message: typeof entry.data.message === 'string' ? entry.data.message : `${entry.type} event`,
    timestamp: entry.timestamp,
    ticker: typeof entry.data.ticker === 'string' ? entry.data.ticker : undefined,
    metadata: entry.data ? JSON.stringify(entry.data) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Query resolver
// ---------------------------------------------------------------------------

interface ActivityLogArgs {
  types?: ActivityEventType[];
  since?: string;
  limit?: number;
}

export async function activityLogQuery(_parent: unknown, args: ActivityLogArgs): Promise<ActivityEvent[]> {
  const limit = args.limit ?? 50;
  let events: ActivityEvent[];

  if (eventLog) {
    const raw = await eventLog.recent(200);
    events = raw.map(eventLogEntryToActivity).filter((e): e is ActivityEvent => e !== null);
  } else {
    events = createMockEvents();
  }

  // Filter by types
  if (args.types && args.types.length > 0) {
    const typeSet = new Set(args.types);
    events = events.filter((e) => typeSet.has(e.type));
  }

  // Filter by since
  if (args.since) {
    const since = args.since;
    events = events.filter((e) => e.timestamp >= since);
  }

  // Sort newest first, apply limit
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return events.slice(0, limit);
}
