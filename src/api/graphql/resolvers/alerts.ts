/**
 * Alert resolvers — alerts, createAlert, dismissAlert.
 */

import { pubsub } from '../pubsub.js';
import type { Alert, AlertRuleInput, AlertStatus } from '../types.js';

// ---------------------------------------------------------------------------
// In-memory store (replaced by JSONL persistence when available)
// ---------------------------------------------------------------------------

function createDefaultAlerts(): Alert[] {
  return [
    {
      id: 'alert-001',
      rule: { type: 'PRICE_MOVE', symbol: 'AAPL', threshold: 5, direction: 'UP' },
      status: 'ACTIVE',
      message: 'AAPL price move > 5%',
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
    {
      id: 'alert-002',
      rule: { type: 'CONCENTRATION_DRIFT', threshold: 0.6 },
      status: 'TRIGGERED',
      message: 'BTC concentration exceeded 60% threshold',
      triggeredAt: new Date(Date.now() - 3_600_000).toISOString(),
      createdAt: new Date(Date.now() - 172_800_000).toISOString(),
    },
  ];
}

const alertStore: Alert[] = createDefaultAlerts();

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export function alertsQuery(_parent: unknown, args: { status?: AlertStatus }): Alert[] {
  if (args.status) {
    return alertStore.filter((a) => a.status === args.status);
  }
  return alertStore;
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

export function createAlertMutation(_parent: unknown, args: { rule: AlertRuleInput }): Alert {
  const alert: Alert = {
    id: `alert-${Date.now()}`,
    rule: args.rule,
    status: 'ACTIVE',
    message: `${args.rule.type} alert${args.rule.symbol ? ` for ${args.rule.symbol}` : ''}`,
    createdAt: new Date().toISOString(),
  };

  alertStore.push(alert);
  pubsub.publish('alert', alert);
  return alert;
}

export function dismissAlertMutation(_parent: unknown, args: { id: string }): Alert {
  const alert = alertStore.find((a) => a.id === args.id);
  if (!alert) {
    throw new Error(`Alert not found: ${args.id}`);
  }

  alert.status = 'DISMISSED';
  alert.dismissedAt = new Date().toISOString();
  return alert;
}
