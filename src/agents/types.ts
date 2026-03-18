/**
 * Agent types — represents an AI agent that processes conversations.
 */

import { z } from 'zod';

import type { AgentMessage } from '../core/types.js';

// ---------------------------------------------------------------------------
// Conversation types
// ---------------------------------------------------------------------------

export interface AgentContext {
  providerId: string;
  model: string;
  channelId: string;
  threadId?: string;
  userId: string;
}

export interface Agent {
  id: string;
  name: string;
  systemPrompt?: string;

  /** Process a conversation and return a response. */
  process(context: AgentContext, history: AgentMessage[], userMessage: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Agent profile — serializable config for agent identity and tool scoping
// ---------------------------------------------------------------------------

export const AgentRoleSchema = z.enum(['analyst', 'strategist', 'risk-manager', 'trader']);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const AgentProfileSchema = z.object({
  /** Unique agent identifier (kebab-case, e.g. 'research-analyst'). */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Display name. */
  name: z.string().min(1),
  /** Agent role. */
  role: AgentRoleSchema,
  /** Short description of the agent's purpose. */
  description: z.string(),
  /** Tool names this agent can use (subset of ToolRegistry). */
  tools: z.array(z.string()),
  /** Action types this agent is allowed to perform (for guard pipeline). */
  allowedActions: z.array(z.string()),
  /** Capability tags describing what this agent can do. */
  capabilities: z.array(z.string()),
  /** Optional LLM provider override (e.g. 'anthropic'). */
  provider: z.string().optional(),
  /** Optional model override (e.g. 'claude-sonnet-4-20250514'). */
  model: z.string().optional(),
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

/**
 * AgentProfile with its system prompt loaded from Markdown.
 *
 * Separated from AgentProfile because the system prompt is loaded at runtime
 * from data/default/agents/{id}.default.md (or user override), not stored in
 * the serializable config.
 */
export interface LoadedAgentProfile extends AgentProfile {
  systemPrompt: string;
}
