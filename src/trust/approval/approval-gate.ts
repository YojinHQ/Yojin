/**
 * ApprovalGate — human-in-the-loop for irreversible actions.
 *
 * Routes approval requests to the user's active channel, waits for
 * approve/deny, and auto-denies on timeout. All decisions are logged
 * to the security audit log.
 */

import { randomUUID } from 'node:crypto';

import type { ApprovalAction, ApprovalGateConfig } from './config.js';
import { DEFAULT_APPROVAL_CONFIG } from './config.js';
import type { NotificationBus } from '../../core/notification-bus.js';
import type { AuditLog } from '../audit/types.js';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ApprovalRequest {
  id: string;
  action: string;
  description: string;
  agentId?: string;
  createdAt: string;
  expiresAt: string;
  status: ApprovalStatus;
}

export type ApprovalResult = { approved: true } | { approved: false; reason: string; timedOut: boolean };

interface PendingRequest {
  request: ApprovalRequest;
  resolve: (result: ApprovalResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ApprovalGateOptions {
  config?: ApprovalGateConfig;
  auditLog: AuditLog;
  notificationBus?: NotificationBus;
}

export class ApprovalGate {
  private readonly config: ApprovalGateConfig;
  private readonly auditLog: AuditLog;
  private notificationBus?: NotificationBus;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: ApprovalGateOptions) {
    this.config = options.config ?? DEFAULT_APPROVAL_CONFIG;
    this.auditLog = options.auditLog;
    this.notificationBus = options.notificationBus;
  }

  /** Check if an action type requires approval (without requesting it). */
  needsApproval(action: string): boolean {
    return this.config.actionsRequiringApproval.includes(action as ApprovalAction);
  }

  /** Request approval for an action. Returns a promise that resolves on user response or timeout. */
  async requestApproval(action: string, description: string, agentId?: string): Promise<ApprovalResult> {
    const now = new Date();
    const request: ApprovalRequest = {
      id: randomUUID(),
      action,
      description,
      agentId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.timeoutMs).toISOString(),
      status: 'pending',
    };

    this.auditLog.append({
      type: 'approval.request',
      agentId,
      details: {
        requestId: request.id,
        action,
        description,
      },
    });

    return new Promise<ApprovalResult>((resolve) => {
      const timer = setTimeout(() => {
        this.resolveRequest(request.id, false, 'Approval timed out', true);
      }, this.config.timeoutMs);

      this.pending.set(request.id, { request, resolve, timer });

      this.notificationBus?.publish({
        type: 'approval.requested',
        requestId: request.id,
        action,
        description,
      });
    });
  }

  /** Resolve a pending approval (called by channel handler when user responds). */
  resolve(requestId: string, approved: boolean, reason?: string): void {
    this.resolveRequest(requestId, approved, reason ?? (approved ? 'Approved' : 'Denied'), false);
  }

  /** Get all pending approval requests. */
  getPending(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => ({ ...p.request }));
  }

  static readonly MIN_TIMEOUT_MS = 5_000;

  /** Update configuration at runtime. */
  configure(update: Partial<ApprovalGateConfig>): void {
    if (update.actionsRequiringApproval) {
      this.config.actionsRequiringApproval = update.actionsRequiringApproval;
    }
    if (update.timeoutMs !== undefined) {
      if (update.timeoutMs < ApprovalGate.MIN_TIMEOUT_MS) {
        throw new Error(`timeoutMs must be at least ${ApprovalGate.MIN_TIMEOUT_MS}ms (got ${update.timeoutMs}ms)`);
      }
      (this.config as { timeoutMs: number }).timeoutMs = update.timeoutMs;
    }
  }

  private resolveRequest(requestId: string, approved: boolean, reason: string, timedOut: boolean): void {
    const entry = this.pending.get(requestId);
    if (!entry) return;

    clearTimeout(entry.timer);
    entry.request.status = approved ? 'approved' : timedOut ? 'expired' : 'denied';
    this.pending.delete(requestId);

    const startTime = new Date(entry.request.createdAt).getTime();
    const latencyMs = Date.now() - startTime;

    this.auditLog.append({
      type: 'approval.result',
      agentId: entry.request.agentId,
      details: {
        requestId,
        approved,
        timedOut,
        latencyMs,
      },
    });

    const result: ApprovalResult = approved ? { approved: true } : { approved: false, reason, timedOut };

    entry.resolve(result);
  }
}
