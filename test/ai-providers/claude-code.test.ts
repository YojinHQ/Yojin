import { describe, expect, it } from 'vitest';

import { ClaudeCodeProvider } from '../../src/ai-providers/claude-code.js';

describe('ClaudeCodeProvider', () => {
  it('has correct id and name', () => {
    const provider = new ClaudeCodeProvider();
    expect(provider.id).toBe('claude-code');
    expect(provider.name).toBe('Claude Code');
  });

  it('lists claude models', () => {
    const provider = new ClaudeCodeProvider();
    expect(provider.models().length).toBeGreaterThan(0);
    expect(provider.models()).toContain('claude-opus-4-6');
  });

  it('isAvailable checks for claude CLI', async () => {
    const provider = new ClaudeCodeProvider();
    const available = await provider.isAvailable();
    expect(typeof available).toBe('boolean');
  });
});
