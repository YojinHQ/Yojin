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

// ---------------------------------------------------------------------------
// Agent display names
// ---------------------------------------------------------------------------

const AGENT_DISPLAY: Record<string, string> = {
  'research-analyst': 'Research Analyst',
  strategist: 'Strategist',
  'risk-manager': 'Risk Manager',
  trader: 'Trader',
  'bull-researcher': 'Bull Researcher',
  'bear-researcher': 'Bear Researcher',
  chat: 'Chat',
};

/**
 * Map raw event-log types to ActivityEvent.
 *
 * Direct types (TRADE, SYSTEM, etc.) pass through. Dotted namespaced types
 * (agent.run.start, agent.run.complete, agent.run.error) are mapped to SYSTEM
 * with a human-readable message.
 */
function eventLogEntryToActivity(entry: {
  id: string;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}): ActivityEvent | null {
  // Direct match (e.g. type is already "system", "trade", etc.)
  const upperType = entry.type.toUpperCase();
  if (isActivityEventType(upperType)) {
    return {
      id: entry.id,
      type: upperType,
      message: typeof entry.data.message === 'string' ? entry.data.message : `${entry.type} event`,
      timestamp: entry.timestamp,
      ticker: typeof entry.data.ticker === 'string' ? entry.data.ticker : undefined,
      metadata: entry.data ? JSON.stringify(entry.data) : undefined,
    };
  }

  // Map namespaced event types to activity types
  const agentId = typeof entry.data.agentId === 'string' ? entry.data.agentId : '';
  const agentName = AGENT_DISPLAY[agentId] ?? agentId;

  // Skip start events — they're noisy. Only show completions and errors.
  if (entry.type === 'agent.run.start') {
    return null;
  }

  if (entry.type === 'agent.run.complete') {
    const iterations = typeof entry.data.iterations === 'number' ? entry.data.iterations : 0;
    return {
      id: entry.id,
      type: 'SYSTEM',
      message: `${agentName} completed analysis (${iterations} iteration${iterations !== 1 ? 's' : ''})`,
      timestamp: entry.timestamp,
      metadata: JSON.stringify(entry.data),
    };
  }

  if (entry.type === 'agent.run.error') {
    return {
      id: entry.id,
      type: 'ALERT',
      message: `${agentName} agent failed: ${typeof entry.data.error === 'string' ? entry.data.error : 'unknown error'}`,
      timestamp: entry.timestamp,
      metadata: JSON.stringify(entry.data),
    };
  }

  return null;
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
