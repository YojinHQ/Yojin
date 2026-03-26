import { describe, expect, it } from 'vitest';

import { createDefaultProfiles } from '../../src/agents/defaults.js';
import { AgentProfileSchema } from '../../src/agents/types.js';

describe('createDefaultProfiles', () => {
  const profiles = createDefaultProfiles();

  it('creates exactly 6 profiles', () => {
    expect(profiles).toHaveLength(6);
  });

  it('has unique ids', () => {
    const ids = profiles.map((p) => p.id);
    expect(new Set(ids).size).toBe(6);
  });

  it('assigns correct roles', () => {
    const roles = Object.fromEntries(profiles.map((p) => [p.id, p.role]));
    expect(roles).toEqual({
      'research-analyst': 'analyst',
      strategist: 'strategist',
      'risk-manager': 'risk-manager',
      trader: 'trader',
      'bull-researcher': 'analyst',
      'bear-researcher': 'analyst',
    });
  });

  it('all profiles pass Zod validation', () => {
    for (const profile of profiles) {
      const result = AgentProfileSchema.safeParse(profile);
      expect(result.success, `Profile "${profile.id}" failed validation: ${result.error?.message}`).toBe(true);
    }
  });

  it('all profiles have non-empty tool lists', () => {
    for (const profile of profiles) {
      expect(profile.tools.length, `Profile "${profile.id}" has no tools`).toBeGreaterThan(0);
    }
  });

  it('all profiles have non-empty capabilities', () => {
    for (const profile of profiles) {
      expect(profile.capabilities.length, `Profile "${profile.id}" has no capabilities`).toBeGreaterThan(0);
    }
  });

  it('brain tools are exclusive to the strategist', () => {
    const brainTools = [
      'brain_get_memory',
      'brain_update_memory',
      'brain_get_emotion',
      'brain_update_emotion',
      'brain_get_persona',
      'brain_get_log',
      'brain_rollback',
    ];

    for (const profile of profiles) {
      if (profile.id === 'strategist') {
        for (const tool of brainTools) {
          expect(profile.tools, `Strategist missing brain tool: ${tool}`).toContain(tool);
        }
      } else {
        for (const tool of brainTools) {
          expect(profile.tools, `Non-strategist "${profile.id}" has brain tool: ${tool}`).not.toContain(tool);
        }
      }
    }
  });

  it('portfolio_reasoning is exclusive to the strategist', () => {
    for (const profile of profiles) {
      if (profile.id === 'strategist') {
        expect(profile.tools).toContain('portfolio_reasoning');
      } else {
        expect(profile.tools).not.toContain('portfolio_reasoning');
      }
    }
  });

  it('credential tools are exclusive to the trader', () => {
    const credTools = ['store_credential', 'check_credential', 'list_credentials'];
    for (const profile of profiles) {
      if (profile.id === 'trader') {
        for (const tool of credTools) {
          expect(profile.tools).toContain(tool);
        }
      } else {
        for (const tool of credTools) {
          expect(profile.tools).not.toContain(tool);
        }
      }
    }
  });
});
