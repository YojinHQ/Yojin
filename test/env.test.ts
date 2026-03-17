import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { EnvSchema, loadEnv, _resetEnvCache } from '../src/config/env.js';

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

describe('EnvSchema', () => {
  it('accepts empty env (all optional)', () => {
    const result = EnvSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('trims whitespace from string values', () => {
    const result = EnvSchema.parse({ ANTHROPIC_API_KEY: '  sk-ant-key  ' });
    expect(result.ANTHROPIC_API_KEY).toBe('sk-ant-key');
  });

  it('treats empty strings as undefined', () => {
    const result = EnvSchema.parse({ ANTHROPIC_API_KEY: '' });
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('treats whitespace-only strings as undefined', () => {
    const result = EnvSchema.parse({ CLAUDE_CODE_OAUTH_TOKEN: '   ' });
    expect(result.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  describe('Slack token prefix validation', () => {
    it('accepts valid SLACK_BOT_TOKEN prefix', () => {
      const result = EnvSchema.safeParse({ SLACK_BOT_TOKEN: 'xoxb-123-456' });
      expect(result.success).toBe(true);
      expect(result.data?.SLACK_BOT_TOKEN).toBe('xoxb-123-456');
    });

    it('rejects SLACK_BOT_TOKEN with wrong prefix', () => {
      const result = EnvSchema.safeParse({ SLACK_BOT_TOKEN: 'xoxp-wrong-type' });
      expect(result.success).toBe(false);
    });

    it('accepts valid SLACK_APP_TOKEN prefix', () => {
      const result = EnvSchema.safeParse({ SLACK_APP_TOKEN: 'xapp-1-ABC' });
      expect(result.success).toBe(true);
    });

    it('rejects SLACK_APP_TOKEN with wrong prefix', () => {
      const result = EnvSchema.safeParse({ SLACK_APP_TOKEN: 'xoxb-not-app-token' });
      expect(result.success).toBe(false);
    });

    it('accepts empty Slack tokens (treated as not set)', () => {
      const result = EnvSchema.safeParse({ SLACK_BOT_TOKEN: '', SLACK_APP_TOKEN: '' });
      expect(result.success).toBe(true);
      expect(result.data?.SLACK_BOT_TOKEN).toBeUndefined();
    });
  });

  describe('port validation', () => {
    it('coerces YOJIN_PORT from string to number', () => {
      const result = EnvSchema.parse({ YOJIN_PORT: '8080' });
      expect(result.YOJIN_PORT).toBe(8080);
    });

    it('rejects non-numeric port', () => {
      const result = EnvSchema.safeParse({ YOJIN_PORT: 'abc' });
      expect(result.success).toBe(false);
    });

    it('rejects port out of range', () => {
      const result = EnvSchema.safeParse({ YOJIN_PORT: '99999' });
      expect(result.success).toBe(false);
    });

    it('rejects port zero', () => {
      const result = EnvSchema.safeParse({ YOJIN_PORT: '0' });
      expect(result.success).toBe(false);
    });
  });

  describe('log level validation', () => {
    it('accepts valid log levels', () => {
      for (const level of ['debug', 'info', 'warn', 'error', 'fatal']) {
        const result = EnvSchema.safeParse({ YOJIN_LOG_LEVEL: level });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid log level', () => {
      const result = EnvSchema.safeParse({ YOJIN_LOG_LEVEL: 'verbose' });
      expect(result.success).toBe(false);
    });
  });

  describe('NODE_ENV validation', () => {
    it('accepts valid NODE_ENV values', () => {
      for (const env of ['development', 'production', 'test']) {
        const result = EnvSchema.safeParse({ NODE_ENV: env });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid NODE_ENV', () => {
      const result = EnvSchema.safeParse({ NODE_ENV: 'staging' });
      expect(result.success).toBe(false);
    });
  });
});

describe('loadEnv', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    _resetEnvCache();
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.YOJIN_LOG_LEVEL;
  });

  afterEach(() => {
    _resetEnvCache();
    process.env = { ...savedEnv };
  });

  it('returns validated env', () => {
    const env = loadEnv();
    expect(env).toBeDefined();
  });

  it('caches result across calls', () => {
    const first = loadEnv();
    const second = loadEnv();
    expect(first).toBe(second);
  });

  it('throws on invalid env vars with descriptive message', () => {
    process.env.SLACK_BOT_TOKEN = 'not-a-valid-slack-token';
    expect(() => loadEnv()).toThrow('Invalid environment variables');
  });
});
