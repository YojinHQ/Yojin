import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig, YojinConfigSchema } from '../src/config/config.js';

// Mock dotenv so loadConfig doesn't read .env files during tests
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

describe('YojinConfigSchema', () => {
  it('provides defaults for empty input', () => {
    const result = YojinConfigSchema.parse({});
    expect(result.providers).toEqual([]);
    expect(result.channels).toEqual([]);
    expect(result.port).toBe(3000);
    expect(result.defaultProvider).toBeUndefined();
    expect(result.defaultModel).toBeUndefined();
  });

  it('validates provider config', () => {
    const result = YojinConfigSchema.parse({
      providers: [{ id: 'anthropic', authMode: 'api_key' }],
    });
    expect(result.providers[0].id).toBe('anthropic');
    expect(result.providers[0].authMode).toBe('api_key');
  });

  it('rejects invalid authMode', () => {
    expect(() =>
      YojinConfigSchema.parse({
        providers: [{ id: 'test', authMode: 'invalid' }],
      }),
    ).toThrow();
  });

  it('validates channel config with defaults', () => {
    const result = YojinConfigSchema.parse({
      channels: [{ id: 'slack' }],
    });
    expect(result.channels[0].enabled).toBe(true);
  });

  it('accepts custom port', () => {
    const result = YojinConfigSchema.parse({ port: 8080 });
    expect(result.port).toBe(8080);
  });
});

describe('loadConfig', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_APP_TOKEN;
    delete process.env.SLACK_SIGNING_SECRET;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('returns valid config with no env vars set', () => {
    const config = loadConfig();
    expect(config.providers).toHaveLength(1);
    expect(config.providers[0].id).toBe('anthropic');
    expect(config.channels).toHaveLength(2);
    expect(config.channels[0].id).toBe('slack');
    expect(config.channels[0].enabled).toBe(false);
    expect(config.channels[1].id).toBe('web');
  });

  it('resolves oauth auth mode when CLAUDE_CODE_OAUTH_TOKEN is set', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-test-token';
    const config = loadConfig();
    expect(config.providers[0].authMode).toBe('oauth');
    expect(config.providers[0].oauthToken).toBe('sk-ant-oat01-test-token');
  });

  it('resolves api_key auth mode when only ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key';
    const config = loadConfig();
    expect(config.providers[0].authMode).toBe('api_key');
    expect(config.providers[0].apiKey).toBe('sk-ant-api03-test-key');
  });

  it('prefers oauth over api_key when both are set', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-token';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-key';
    const config = loadConfig();
    expect(config.providers[0].authMode).toBe('oauth');
  });

  it('applies overrides', () => {
    const config = loadConfig({ port: 9999, defaultModel: 'custom-model' });
    expect(config.port).toBe(9999);
    expect(config.defaultModel).toBe('custom-model');
  });

  it('ignores whitespace-only tokens', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = '   ';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-real-key';
    const config = loadConfig();
    expect(config.providers[0].authMode).toBe('api_key');
  });
});
