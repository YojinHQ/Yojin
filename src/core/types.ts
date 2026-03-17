/**
 * Core types for the Thought → Action → Observation agent loop.
 */

import type { ZodSchema } from 'zod';

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

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

// ---------------------------------------------------------------------------
// Agent loop events
// ---------------------------------------------------------------------------

export type AgentLoopEvent =
  | { type: 'thought'; text: string }
  | { type: 'action'; toolCalls: ToolCall[] }
  | { type: 'observation'; results: ToolCallResult[] }
  | { type: 'done'; text: string; iterations: number }
  | { type: 'error'; error: string; iterations: number }
  | { type: 'max_iterations'; iterations: number };

export type AgentLoopEventHandler = (event: AgentLoopEvent) => void;

// ---------------------------------------------------------------------------
// Agent loop options
// ---------------------------------------------------------------------------

export interface AgentLoopOptions {
  provider: AgentLoopProvider;
  model: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxIterations?: number;
  onEvent?: AgentLoopEventHandler;
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
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
