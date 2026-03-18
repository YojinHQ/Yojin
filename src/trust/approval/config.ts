/**
 * Approval gate configuration.
 */

import { z } from 'zod';

export const ApprovalActionSchema = z.enum(['trade.execute', 'platform.connect', 'config.change', 'posture.change']);
export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;

export const ApprovalGateConfigSchema = z.object({
  actionsRequiringApproval: z.array(ApprovalActionSchema),
  /** Timeout in milliseconds. Auto-deny on expiry. */
  timeoutMs: z.number().default(5 * 60 * 1000),
});
export type ApprovalGateConfig = z.infer<typeof ApprovalGateConfigSchema>;

export const DEFAULT_APPROVAL_CONFIG: ApprovalGateConfig = {
  actionsRequiringApproval: ['trade.execute', 'platform.connect', 'config.change', 'posture.change'],
  timeoutMs: 5 * 60 * 1000,
};
