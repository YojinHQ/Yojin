/**
 * Operational posture definitions.
 *
 * Three profiles control how aggressively guards enforce:
 * - Local:     production default — strict enforcement, 30 calls/min
 * - Standard:  development — enforcement on, 60 calls/min
 * - Unbounded: research — observe-only logging, 120 calls/min
 */

import type { PostureConfig, PostureName } from './types.js';

export const POSTURE_CONFIGS: Record<PostureName, PostureConfig> = {
  local: {
    name: 'local',
    rateLimit: 30,
    readOnly: false,
    guardsEnabled: ['*'],
    mode: 'enforce',
  },
  standard: {
    name: 'standard',
    rateLimit: 60,
    readOnly: false,
    guardsEnabled: ['*'],
    mode: 'enforce',
  },
  unbounded: {
    name: 'unbounded',
    rateLimit: 120,
    readOnly: false,
    guardsEnabled: ['*'],
    mode: 'observe',
  },
};
