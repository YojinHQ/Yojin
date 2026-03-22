/**
 * Core plugin type definitions for Yojin.
 *
 * The plugin system supports two kinds of plugins:
 *   - ProviderPlugin: LLM providers
 *   - ChannelPlugin:  Messaging channels
 */

import type { ZodSchema } from 'zod';

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export type PluginKind = 'provider' | 'channel';

export interface PluginManifest {
  id: string;
  name: string;
  kind: PluginKind;
  description?: string;
  version?: string;
}

// ---------------------------------------------------------------------------
// Provider Plugin
// ---------------------------------------------------------------------------

export interface ProviderAuthMethod {
  methodId: string;
  label: string;
  envVar?: string;
  validate(credentials: Record<string, string>): Promise<boolean>;
}

export interface ProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: string[];
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ProviderCompletionParams {
  model: string;
  messages: ProviderMessage[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  stream?: boolean;
}

export interface ProviderCompletionResult {
  content: string;
  model: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason?: string;
}

export type ProviderStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'stop'; stopReason: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number };

export interface ProviderPlugin {
  id: string;
  label: string;
  description?: string;
  envVars?: string[];
  auth: ProviderAuthMethod[];
  models: ProviderModel[];

  /** Create a completion (non-streaming). */
  complete(params: ProviderCompletionParams): Promise<ProviderCompletionResult>;

  /** Create a streaming completion. Returns an async iterable of events. */
  stream(params: ProviderCompletionParams): AsyncIterable<ProviderStreamEvent>;

  /** Resolve a model alias to a concrete model ID. */
  resolveModel?(modelRef: string): ProviderModel | undefined;

  /** Lifecycle: called when the plugin is initialized. */
  initialize?(config: Record<string, unknown>): Promise<void>;

  /** Lifecycle: called on shutdown. */
  shutdown?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Channel Plugin
// ---------------------------------------------------------------------------

export interface IncomingMessage {
  channelId: string;
  threadId?: string;
  userId: string;
  userName?: string;
  text: string;
  timestamp: string;
  raw?: unknown;
}

export interface OutgoingMessage {
  channelId: string;
  threadId?: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelMessagingAdapter {
  sendMessage(msg: OutgoingMessage): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
}

export interface ChannelAuthAdapter {
  validateToken(token: string): Promise<boolean>;
  getScopes?(): string[];
}

export interface ChannelSetupAdapter {
  setup(config: Record<string, unknown>): Promise<void>;
  teardown?(): Promise<void>;
}

export interface ChannelCapabilities {
  supportsThreading: boolean;
  supportsReactions: boolean;
  supportsTyping: boolean;
  supportsFiles: boolean;
  supportsEditing: boolean;
  maxMessageLength?: number;
}

/** Handle returned by startTyping — call stop() to cancel the typing indicator. */
export interface TypingHandle {
  stop(): Promise<void>;
}

export interface ChannelTypingAdapter {
  /** Start a typing indicator on a channel/thread. Returns a handle to stop it. */
  startTyping(channelId: string, threadTs?: string): Promise<TypingHandle>;
}

export interface ChannelPlugin {
  id: string;
  name: string;
  description?: string;
  aliases?: string[];

  messagingAdapter: ChannelMessagingAdapter;
  authAdapter: ChannelAuthAdapter;
  setupAdapter: ChannelSetupAdapter;
  typingAdapter?: ChannelTypingAdapter;
  capabilities: ChannelCapabilities;

  /** Lifecycle: called when the plugin is initialized. */
  initialize?(config: Record<string, unknown>): Promise<void>;

  /** Lifecycle: called on shutdown. */
  shutdown?(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin Registration API
// ---------------------------------------------------------------------------

export interface YojinPluginApi {
  registerProvider(provider: ProviderPlugin): void;
  registerChannel(channel: ChannelPlugin): void;
}

export interface YojinPlugin {
  id: string;
  name: string;
  description?: string;
  configSchema?: ZodSchema;
  register(api: YojinPluginApi): void;
}
