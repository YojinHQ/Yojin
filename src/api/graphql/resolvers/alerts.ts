/**
 * Alert resolvers — alerts query, dismissAlert mutation.
 *
 * Alerts are AI-driven: promoted automatically from high-severity MicroInsights
 * by the scheduler. No manual createAlert — the AI decides what's critical.
 */

import type { AlertStore } from '../../../alerts/alert-store.js';
import type { AlertStatus } from '../../../alerts/types.js';

// ---------------------------------------------------------------------------
// Module-level store injection (set from composition root)
// ---------------------------------------------------------------------------

let store: AlertStore | undefined;

export function setAlertStore(s: AlertStore): void {
  store = s;
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function alertsQuery(
  _parent: unknown,
  args: { status?: AlertStatus },
): Promise<Array<Record<string, unknown>>> {
  if (!store) return [];
  const alerts = await store.query({ status: args.status ?? undefined });
  return alerts;
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

export async function dismissAlertMutation(_parent: unknown, args: { id: string }): Promise<Record<string, unknown>> {
  if (!store) throw new Error('Alert store not available');
  const result = await store.dismiss(args.id);
  if (!result.success) throw new Error(result.error);
  return result.data;
}
