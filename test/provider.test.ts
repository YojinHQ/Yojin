import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAnthropicProvider } from '../providers/anthropic/src/provider.js';

// Mock the logger
vi.mock('../src/logging/index.js', () => ({
  getLogger: () => ({
    sub: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  }),
}));

describe('buildAnthropicProvider', () => {
  it('returns a provider with correct id and label', () => {
    const provider = buildAnthropicProvider();
    expect(provider.id).toBe('anthropic');
    expect(provider.label).toBe('Anthropic');
  });

  it('has three models defined', () => {
    const provider = buildAnthropicProvider();
    expect(provider.models).toHaveLength(3);
    expect(provider.models.map((m) => m.id)).toEqual([
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      'claude-haiku-4-20250514',
    ]);
  });

  it('models have correct capabilities', () => {
    const provider = buildAnthropicProvider();
    for (const model of provider.models) {
      expect(model.capabilities).toContain('text');
      expect(model.capabilities).toContain('vision');
      expect(model.capabilities).toContain('tool_use');
      expect(model.contextWindow).toBe(200_000);
    }
  });

  it('has two auth methods', () => {
    const provider = buildAnthropicProvider();
    expect(provider.auth).toHaveLength(2);
    expect(provider.auth[0].envVar).toBe('CLAUDE_CODE_OAUTH_TOKEN');
    expect(provider.auth[1].envVar).toBe('ANTHROPIC_API_KEY');
  });

  it('lists expected envVars', () => {
    const provider = buildAnthropicProvider();
    expect(provider.envVars).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(provider.envVars).toContain('ANTHROPIC_API_KEY');
  });

  describe('resolveModel', () => {
    it("resolves 'opus' alias", () => {
      const provider = buildAnthropicProvider();
      const model = provider.resolveModel!('opus');
      expect(model?.id).toBe('claude-opus-4-20250514');
    });

    it("resolves 'sonnet' alias", () => {
      const provider = buildAnthropicProvider();
      const model = provider.resolveModel!('sonnet');
      expect(model?.id).toBe('claude-sonnet-4-20250514');
    });

    it("resolves 'haiku' alias", () => {
      const provider = buildAnthropicProvider();
      const model = provider.resolveModel!('haiku');
      expect(model?.id).toBe('claude-haiku-4-20250514');
    });

    it('resolves full model id', () => {
      const provider = buildAnthropicProvider();
      const model = provider.resolveModel!('claude-opus-4-20250514');
      expect(model?.id).toBe('claude-opus-4-20250514');
    });

    it('returns undefined for unknown model', () => {
      const provider = buildAnthropicProvider();
      expect(provider.resolveModel!('gpt-4')).toBeUndefined();
    });
  });

  describe('initialize', () => {
    const savedEnv = { ...process.env };

    beforeEach(() => {
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      delete process.env.ANTHROPIC_API_KEY;
    });

    afterEach(() => {
      process.env = { ...savedEnv };
    });

    it('initializes in cli mode when CLAUDE_CODE_OAUTH_TOKEN is set', async () => {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test';
      const provider = buildAnthropicProvider();
      await provider.initialize!({});
      // Provider should not throw during initialization
    });

    it('initializes in api_key mode when ANTHROPIC_API_KEY is set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test';
      const provider = buildAnthropicProvider();
      await provider.initialize!({});
    });

    it('initializes with SDK defaults when no credentials', async () => {
      const provider = buildAnthropicProvider();
      await provider.initialize!({});
    });
  });
});
