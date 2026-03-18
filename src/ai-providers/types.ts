import type { AgentLoopProvider } from '../core/types.js';

// Re-export the canonical config schema — single source of truth in config.ts
export { AIProviderConfigSchema } from '../config/config.js';
export type { AIProviderConfig } from '../config/config.js';

export interface AIProvider extends AgentLoopProvider {
  id: string;
  name: string;
  /** Cached model list (populated at registration). */
  models(): string[];
  /** Check if provider is available (credentials exist, CLI installed, etc). */
  isAvailable(): Promise<boolean>;
}
