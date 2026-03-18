/**
 * AgentRegistry — manages agent profiles and resolves tool scoping.
 *
 * Profiles are registered at startup. The registry provides:
 * - CRUD for agent profiles
 * - System prompt loading via the default/override pattern
 * - Tool subset resolution via ToolRegistry
 */

import type { AgentProfile, AgentRole, LoadedAgentProfile } from './types.js';
import { AgentProfileSchema } from './types.js';
import { loadAgentPrompt } from '../brain/persona.js';
import type { ToolRegistry } from '../core/tool-registry.js';
import type { ToolDefinition } from '../core/types.js';

export class AgentRegistry {
  private profiles = new Map<string, AgentProfile>();

  /** Register an agent profile. Throws on duplicate id or invalid shape. */
  register(profile: AgentProfile): void {
    const parsed = AgentProfileSchema.safeParse(profile);
    if (!parsed.success) {
      throw new Error(`Invalid agent profile "${profile.id}": ${parsed.error.message}`);
    }

    if (this.profiles.has(profile.id)) {
      throw new Error(`Agent profile already registered: ${profile.id}`);
    }

    this.profiles.set(profile.id, parsed.data);
  }

  /** Unregister an agent profile by id. Returns true if it existed. */
  unregister(id: string): boolean {
    return this.profiles.delete(id);
  }

  /** Get a profile by id. */
  get(id: string): AgentProfile | undefined {
    return this.profiles.get(id);
  }

  /** Get all registered profiles. */
  getAll(): AgentProfile[] {
    return [...this.profiles.values()];
  }

  /** Get all profiles with a given role. */
  getByRole(role: AgentRole): AgentProfile[] {
    return [...this.profiles.values()].filter((p) => p.role === role);
  }

  /** Check if a profile is registered. */
  has(id: string): boolean {
    return this.profiles.has(id);
  }

  /**
   * Load a profile with its system prompt resolved from Markdown files.
   *
   * Uses `loadAgentPrompt()` from `src/brain/persona.ts` which follows
   * the default/override pattern (data/default/agents/ → data/brain/agents/).
   */
  async loadProfile(id: string, dataRoot = '.'): Promise<LoadedAgentProfile> {
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new Error(`Agent profile not found: ${id}`);
    }

    const systemPrompt = await loadAgentPrompt(id, dataRoot);
    return { ...profile, systemPrompt };
  }

  /**
   * Get the ToolDefinition subset for an agent.
   *
   * Takes ToolRegistry as a parameter (dependency inversion) rather than
   * storing a reference. Missing tool names are silently skipped — this
   * allows profiles to forward-declare tools before they're registered.
   */
  getToolsForAgent(id: string, toolRegistry: ToolRegistry): ToolDefinition[] {
    const profile = this.profiles.get(id);
    if (!profile) return [];
    return toolRegistry.subset(profile.tools);
  }
}
