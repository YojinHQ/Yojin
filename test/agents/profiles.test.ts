import { describe, expect, it } from 'vitest';

import { createResearchAnalystProfile } from '../../src/agents/profiles/research-analyst.js';
import { createRiskManagerProfile } from '../../src/agents/profiles/risk-manager.js';
import { createStrategistProfile } from '../../src/agents/profiles/strategist.js';
import { createTraderProfile } from '../../src/agents/profiles/trader.js';
import { AgentProfileSchema } from '../../src/agents/types.js';

describe('Agent Profile Factories', () => {
  it('creates a valid research-analyst profile', () => {
    const profile = createResearchAnalystProfile();
    expect(profile.id).toBe('research-analyst');
    expect(profile.role).toBe('analyst');
    expect(profile.tools.length).toBeGreaterThan(0);
    expect(profile.tools).toContain('jintel_query');
    expect(profile.tools).toContain('enrich_snapshot');
    expect(profile.tools).not.toContain('query_data_source');
    expect(profile.allowedActions).toContain('tool_call');
    expect(profile.capabilities.length).toBeGreaterThan(0);
    AgentProfileSchema.parse(profile);
  });

  it('creates a valid strategist profile', () => {
    const profile = createStrategistProfile();
    expect(profile.id).toBe('strategist');
    expect(profile.role).toBe('strategist');
    expect(profile.allowedActions).toContain('tool_call');
    expect(profile.capabilities.length).toBeGreaterThan(0);
    AgentProfileSchema.parse(profile);
  });

  it('creates a valid risk-manager profile', () => {
    const profile = createRiskManagerProfile();
    expect(profile.id).toBe('risk-manager');
    expect(profile.role).toBe('risk-manager');
    expect(profile.allowedActions).toContain('tool_call');
    expect(profile.capabilities.length).toBeGreaterThan(0);
    AgentProfileSchema.parse(profile);
  });

  it('creates a valid trader profile', () => {
    const profile = createTraderProfile();
    expect(profile.id).toBe('trader');
    expect(profile.role).toBe('trader');
    expect(profile.allowedActions).toContain('tool_call');
    expect(profile.capabilities.length).toBeGreaterThan(0);
    AgentProfileSchema.parse(profile);
  });
});
