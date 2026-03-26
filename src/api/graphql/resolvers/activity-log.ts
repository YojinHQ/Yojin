/**
 * Activity log resolvers — activityLog query.
 *
 * Returns recent activity events from the EventLog.
 * Call setEventLog() from the composition root to wire the real EventLog.
 * Returns an empty array when EventLog is not wired.
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
    events = [];
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
