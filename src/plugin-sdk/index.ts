/**
 * Yojin Plugin SDK — public API for extension authors.
 *
 * Extensions import from "yojin/plugin-sdk" to get stable types
 * and helpers for building provider and channel plugins.
 */

// Core plugin types
export type { YojinPlugin, YojinPluginApi, PluginKind, PluginManifest } from '../plugins/types.js';

// Provider types
export type {
  ProviderPlugin,
  ProviderAuthMethod,
  ProviderModel,
  ProviderMessage,
  ProviderCompletionParams,
  ProviderCompletionResult,
  ProviderStreamEvent,
} from '../plugins/types.js';

// Channel types
export type {
  ChannelPlugin,
  ChannelMessagingAdapter,
  ChannelAuthAdapter,
  ChannelSetupAdapter,
  ChannelCapabilities,
  IncomingMessage,
  OutgoingMessage,
} from '../plugins/types.js';

// Helpers

export function createProviderApiKeyAuth(opts: {
  providerId: string;
  envVar: string;
  label?: string;
}): import('../plugins/types.js').ProviderAuthMethod {
  return {
    methodId: `${opts.providerId}-api-key`,
    label: opts.label ?? `${opts.providerId} API key`,
    envVar: opts.envVar,
    async validate(credentials) {
      const key = credentials[opts.envVar] ?? process.env[opts.envVar];
      return typeof key === 'string' && key.length > 0;
    },
  };
}

export function createProviderOAuthAuth(opts: {
  providerId: string;
  envVar: string;
  label?: string;
}): import('../plugins/types.js').ProviderAuthMethod {
  return {
    methodId: `${opts.providerId}-oauth`,
    label: opts.label ?? `${opts.providerId} OAuth token`,
    envVar: opts.envVar,
    async validate(credentials) {
      const token = credentials[opts.envVar] ?? process.env[opts.envVar];
      return typeof token === 'string' && token.trim().length > 0;
    },
  };
}
