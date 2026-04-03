import { describe, expect, it } from 'vitest';

import { type AgentProfile, AgentProfileSchema } from '../../src/agents/types.js';

describe('AgentProfileSchema', () => {
  it('validates a complete profile', () => {
    const profile: AgentProfile = {
      id: 'research-analyst',
      name: 'Research Analyst',
      role: 'analyst',
      description: 'Market intelligence agent',
      tools: ['equityGetProfile', 'equityGetFinancials'],
      allowedActions: ['tool_call', 'network_request'],
      capabilities: ['market-data'],
    };
    expect(AgentProfileSchema.parse(profile)).toEqual(profile);
  });

  it('accepts optional provider and model overrides', () => {
    const profile: AgentProfile = {
      id: 'strategist',
      name: 'Strategist',
      role: 'strategist',
      description: 'Decision-maker',
      tools: [],
      allowedActions: ['tool_call'],
      capabilities: ['reasoning'],
      provider: 'codex',
      model: 'gpt-4o',
    };
    expect(AgentProfileSchema.parse(profile)).toEqual(profile);
  });

  it('rejects profile with invalid id format', () => {
    expect(() =>
      AgentProfileSchema.parse({
        id: 'INVALID CAPS',
        name: 'Bad',
        role: 'analyst',
        description: 'Test',
        tools: [],
        allowedActions: [],
        capabilities: [],
      }),
    ).toThrow();
  });

  it('rejects profile with unknown role', () => {
    expect(() =>
      AgentProfileSchema.parse({
        id: 'test-agent',
        name: 'Test',
        role: 'unknown-role',
        description: 'Test',
        tools: [],
        allowedActions: [],
        capabilities: [],
      }),
    ).toThrow();
  });
});
