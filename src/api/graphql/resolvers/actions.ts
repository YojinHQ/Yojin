/**
 * Action resolvers — query and mutate Actions (BUY/SELL/REVIEW outcomes
 * produced by Strategy/Strategy triggers). Actions have an approval lifecycle:
 * PENDING -> APPROVED | REJECTED | EXPIRED.
 *
 * Module-level state: setActionStore is called once during server startup.
 */

import type { ActionStore } from '../../../actions/action-store.js';
import type { Action, ActionStatus, ActionVerdict, ConvictionLevel } from '../../../actions/types.js';
import type { TriggerStrength } from '../../../strategies/trigger-strength.js';

function deriveSeverityLabel(severity: number | undefined): string {
  if (severity == null) return 'MEDIUM';
  if (severity >= 0.7) return 'CRITICAL';
  if (severity >= 0.4) return 'HIGH';
  return 'MEDIUM';
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let store: ActionStore | null = null;

export function setActionStore(s: ActionStore): void {
  store = s;
}

// ---------------------------------------------------------------------------
// GraphQL shapes
// ---------------------------------------------------------------------------

interface ActionGql {
  id: string;
  strategyId: string;
  strategyName: string;
  triggerId: string;
  triggerType: string;
  verdict: ActionVerdict;
  what: string;
  why: string;
  sizeGuidance: string | null;
  tickers: string[];
  riskContext: string | null;
  severity: number | null;
  triggerStrength: TriggerStrength;
  suggestedQuantity: number | null;
  suggestedValue: number | null;
  currentPrice: number | null;
  entryRange: string | null;
  targetPrice: number | null;
  stopLoss: number | null;
  horizon: string | null;
  conviction: ConvictionLevel | null;
  maxEntry: number | null;
  catalystImpact: string | null;
  pricedIn: boolean | null;
  severityLabel: string;
  status: ActionStatus;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  dismissedAt: string | null;
}

function toGql(action: Action): ActionGql {
  return {
    id: action.id,
    strategyId: action.strategyId,
    strategyName: action.strategyName,
    triggerId: action.triggerId,
    triggerType: action.triggerType,
    verdict: action.verdict,
    what: action.what,
    why: action.why,
    sizeGuidance: action.sizeGuidance ?? null,
    tickers: action.tickers ?? [],
    riskContext: action.riskContext ?? null,
    severity: action.severity ?? null,
    triggerStrength: action.triggerStrength,
    suggestedQuantity: action.suggestedQuantity ?? null,
    suggestedValue: action.suggestedValue ?? null,
    currentPrice: action.currentPrice ?? null,
    entryRange: action.entryRange ?? null,
    targetPrice: action.targetPrice ?? null,
    stopLoss: action.stopLoss ?? null,
    horizon: action.horizon ?? null,
    conviction: action.conviction ?? null,
    maxEntry: action.maxEntry ?? null,
    catalystImpact: action.catalystImpact ?? null,
    pricedIn: action.pricedIn ?? null,
    severityLabel: deriveSeverityLabel(action.severity),
    status: action.status,
    expiresAt: action.expiresAt,
    createdAt: action.createdAt,
    resolvedAt: action.resolvedAt ?? null,
    resolvedBy: action.resolvedBy ?? null,
    dismissedAt: action.dismissedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

export async function actionsResolver(
  _parent: unknown,
  args: { status?: ActionStatus; since?: string; limit?: number; dismissed?: boolean },
): Promise<ActionGql[]> {
  if (!store) return [];

  const actions = await store.query({
    status: args.status,
    since: args.since,
    limit: args.limit ?? 50,
    dismissed: args.dismissed,
  });

  return actions.map(toGql);
}

export async function actionResolver(_parent: unknown, args: { id: string }): Promise<ActionGql | null> {
  if (!store) return null;

  const action = await store.getById(args.id);
  return action ? toGql(action) : null;
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

export async function approveActionMutation(_parent: unknown, args: { id: string }): Promise<ActionGql> {
  if (!store) throw new Error('Action store not initialized');

  const result = await store.approve(args.id);
  if (!result.success) {
    throw new Error(result.error);
  }

  return toGql(result.data);
}

export async function rejectActionMutation(_parent: unknown, args: { id: string }): Promise<ActionGql> {
  if (!store) throw new Error('Action store not initialized');

  const result = await store.reject(args.id);
  if (!result.success) {
    throw new Error(result.error);
  }

  return toGql(result.data);
}

export async function dismissActionMutation(_parent: unknown, args: { id: string }): Promise<ActionGql> {
  if (!store) throw new Error('Action store not initialized');
  const result = await store.dismiss(args.id);
  if (!result.success) throw new Error(result.error);
  return toGql(result.data);
}
