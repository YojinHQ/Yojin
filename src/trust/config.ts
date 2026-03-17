/**
 * Trust layer configuration schema.
 */

import { z } from 'zod';

import { PostureNameSchema } from '../guards/types.js';
import { ApprovalGateConfigSchema } from './approval/config.js';

export const TrustConfigSchema = z.object({
  /** Active operational posture. */
  posture: PostureNameSchema.default('local'),
  /** Vault configuration. */
  vault: z
    .object({
      path: z.string().default('data/config/vault.enc.json'),
    })
    .default({}),
  /** Approval gate configuration. */
  approval: ApprovalGateConfigSchema.default({
    actionsRequiringApproval: ['trade.execute', 'platform.connect', 'config.change', 'posture.change'],
    timeoutMs: 300000,
  }),
  /** Egress guard allowlist. */
  egress: z
    .object({
      allowedDomains: z.array(z.string()).default([]),
    })
    .default({}),
  /** Symbol whitelist for finance guards. */
  symbolWhitelist: z.array(z.string()).default([]),
});

export type TrustConfig = z.infer<typeof TrustConfigSchema>;
