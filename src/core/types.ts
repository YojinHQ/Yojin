/**
 * Core types for the Thought → Action → Observation agent loop.
 */

import type { ZodSchema } from 'zod';

import type { AgentRuntime } from './agent-runtime.js';
import type { EventLog } from './event-log.js';
import type { ToolRegistry } from './tool-registry.js';
import type { YojinConfig } from '../config/config.js';
import type { ChannelRouter } from '../plugins/channel-router.js';
import type { SessionStore } from '../sessions/types.js';
import type { ChatPiiScanner } from '../trust/pii/chat-scanner.js';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ZodSchema<any>;
  execute: (params: any) => Promise<ToolResult>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ToolResult {
  content: string;
  isError?: boolean;
}

/** Context passed to tool execution for audit logging. */
export interface ToolCallContext {
  agentId?: string;
  sessionId?: string;
}

/**
 * Minimal interface for executing tools — satisfied by both
 * ToolRegistry (plain) and GuardedToolRegistry (guarded).
 */
export interface ToolExecutor {
  execute(name: string, input: unknown, context?: ToolCallContext): Promise<ToolResult>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  result: ToolResult;
}

// ---------------------------------------------------------------------------
// Message types (richer than ProviderMessage — supports tool use)
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: ImageMediaType;
    data: string;
  };
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

// ---------------------------------------------------------------------------
// Agent loop events
// ---------------------------------------------------------------------------

export type AgentLoopEvent =
  | { type: 'thought'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'action'; toolCalls: ToolCall[] }
  | { type: 'observation'; results: ToolCallResult[] }
  | {
      type: 'tool_result_truncated';
      toolName: string;
      originalChars: number;
      truncatedChars: number;
    }
  | { type: 'compaction'; messagesBefore: number; messagesAfter: number; usedLlmSummary: boolean }
  | { type: 'pii_redacted'; entitiesFound: number; typesFound: string[]; processingTimeMs: number }
  | { type: 'done'; text: string; iterations: number }
  | { type: 'error'; error: string; iterations: number }
  | { type: 'max_iterations'; iterations: number };

export type AgentLoopEventHandler = (event: AgentLoopEvent) => void;

// ---------------------------------------------------------------------------
// Agent loop options
// ---------------------------------------------------------------------------

export interface MemoryConfig {
  /** Context window size in tokens (default 200_000). */
  contextWindow?: number;
  /** Fraction of context window that triggers compaction (0-1, default 0.9). */
  compactionThreshold?: number;
  /** Max fraction of context a single tool result can consume (default 0.3). */
  maxToolResultShare?: number;
  /** Max chars for a single tool result (default 50_000). */
  maxToolResultChars?: number;
  /** Number of recent turn pairs to preserve during compaction (default 3). */
  preserveRecentTurns?: number;
}

export interface AgentLoopOptions {
  provider: AgentLoopProvider;
  model: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxIterations?: number;
  memory?: MemoryConfig;
  onEvent?: AgentLoopEventHandler;
  /** Agent identity — included in guard audit logs. */
  agentId?: string;
  /** Abort signal — when triggered, the loop stops after the current iteration. */
  abortSignal?: AbortSignal;
  /** PII scanner for masking sensitive data in user messages before LLM. */
  piiScanner?: ChatPiiScanner;
}

// ---------------------------------------------------------------------------
// Provider interface for the loop (subset of ProviderPlugin)
// ---------------------------------------------------------------------------

export interface AgentLoopProvider {
  completeWithTools(params: {
    model: string;
    system?: string;
    messages: AgentMessage[];
    tools?: ToolSchema[];
    maxTokens?: number;
  }): Promise<{
    content: ContentBlock[];
    stopReason: string;
    usage?: { inputTokens: number; outputTokens: number };
  }>;

  /** Streaming variant — yields text deltas, resolves to the same shape. */
  streamWithTools?(params: {
    model: string;
    system?: string;
    messages: AgentMessage[];
    tools?: ToolSchema[];
    maxTokens?: number;
    onTextDelta?: (text: string) => void;
  }): Promise<{
    content: ContentBlock[];
    stopReason: string;
    usage?: { inputTokens: number; outputTokens: number };
  }>;
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Composition root context
// ---------------------------------------------------------------------------

export interface YojinContext {
  config: YojinConfig;
  toolRegistry: ToolRegistry;
  sessionStore: SessionStore;
  eventLog: EventLog;
  channelRouter: ChannelRouter;
  agentRuntime?: AgentRuntime;
}
