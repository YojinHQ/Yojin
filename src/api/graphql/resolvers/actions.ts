/**
 * Action resolvers — query and mutate actions with approval workflow.
 *
 * Module-level state: setActionStore is called once during server startup.
 */

import type { ActionStore } from '../../../actions/action-store.js';
import type { Action, ActionStatus } from '../../../actions/types.js';

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
  signalId: string | null;
  skillId: string | null;
  what: string;
  why: string;
  source: string;
  riskContext: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  dismissedAt: string | null;
}

function toGql(action: Action): ActionGql {
  return {
    id: action.id,
    signalId: action.signalId ?? null,
    skillId: action.skillId ?? null,
    what: action.what,
    why: action.why,
    source: action.source,
    riskContext: action.riskContext ?? null,
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
