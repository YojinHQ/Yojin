/**
 * Yojin — public API surface.
 */

export { Gateway } from './gateway/index.js';
export { PluginRegistry } from './plugins/index.js';
export { loadConfig } from './config/index.js';

// Re-export all plugin types
export type {
  YojinPlugin,
  YojinPluginApi,
  ProviderPlugin,
  ChannelPlugin,
  ProviderCompletionParams,
  ProviderCompletionResult,
  ProviderStreamEvent,
  IncomingMessage,
  OutgoingMessage,
} from './plugins/index.js';

export type { YojinConfig } from './config/index.js';

// Auth
export {
  generatePkceParams,
  buildClaudeOAuthUrl,
  exchangeClaudeOAuthCode,
  refreshClaudeOAuthToken,
  loginClaudeOAuth,
  createTokenReference,
} from './auth/index.js';
export type { ClaudeOAuthResult } from './auth/index.js';
