import { z } from 'zod';

import type { AgentMessage } from '../core/types.js';

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
  /** Optional model override (e.g. 'claude-opus-4-6'). */
  model: z.string().optional(),
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

/**
 * AgentProfile with its system prompt loaded from Markdown.
 *
 * Separated from AgentProfile because the system prompt is loaded at runtime
 * from the package defaults (via resolveDefaultsRoot()) or user override, not stored in
 * the serializable config.
 */
export interface LoadedAgentProfile extends AgentProfile {
  systemPrompt: string;
}

// ---------------------------------------------------------------------------
// Agent step result — output of a single agent invocation in a workflow
// ---------------------------------------------------------------------------

export interface AgentStepResult {
  agentId: string;
  text: string;
  messages: AgentMessage[];
  iterations: number;
  usage: { inputTokens: number; outputTokens: number };
  compactions: number;
}

// ---------------------------------------------------------------------------
// Workflow types — orchestration primitives
// ---------------------------------------------------------------------------

export interface WorkflowStep {
  agentId: string;
  buildMessage: (previousOutputs: Map<string, AgentStepResult>, triggerMessage?: string) => string;
}

export type WorkflowStage = WorkflowStep | WorkflowStep[];

export interface Workflow {
  id: string;
  name: string;
  stages: WorkflowStage[];
  /** Optional hooks keyed by stage index — run after the stage at that index completes. */
  afterStageHooks?: Map<number, () => Promise<void>>;
}
