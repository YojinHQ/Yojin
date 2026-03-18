import { afterEach, describe, expect, it } from 'vitest';

import { createProviderApiKeyAuth, createProviderOAuthAuth } from '../src/plugin-sdk/index.js';

describe('createProviderApiKeyAuth', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('creates auth method with correct id and label', () => {
    const auth = createProviderApiKeyAuth({
      providerId: 'anthropic',
      envVar: 'ANTHROPIC_API_KEY',
    });
    expect(auth.methodId).toBe('anthropic-api-key');
    expect(auth.label).toBe('anthropic API key');
    expect(auth.envVar).toBe('ANTHROPIC_API_KEY');
  });

  it('uses custom label when provided', () => {
    const auth = createProviderApiKeyAuth({
      providerId: 'anthropic',
      envVar: 'ANTHROPIC_API_KEY',
      label: 'Custom Label',
    });
    expect(auth.label).toBe('Custom Label');
  });

  it('validates when key is in credentials', async () => {
    const auth = createProviderApiKeyAuth({
      providerId: 'test',
      envVar: 'TEST_KEY',
    });
    expect(await auth.validate({ TEST_KEY: 'sk-123' })).toBe(true);
  });

  it('validates from env when not in credentials', async () => {
    process.env.TEST_KEY = 'sk-from-env';
    const auth = createProviderApiKeyAuth({
      providerId: 'test',
      envVar: 'TEST_KEY',
    });
    expect(await auth.validate({})).toBe(true);
  });

  it('fails validation when key is empty', async () => {
    const auth = createProviderApiKeyAuth({
      providerId: 'test',
      envVar: 'TEST_KEY',
    });
    expect(await auth.validate({ TEST_KEY: '' })).toBe(false);
  });

  it('fails validation when key is missing', async () => {
    delete process.env.MISSING_KEY;
    const auth = createProviderApiKeyAuth({
      providerId: 'test',
      envVar: 'MISSING_KEY',
    });
    expect(await auth.validate({})).toBe(false);
  });
});

describe('createProviderOAuthAuth', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('creates auth method with correct id and label', () => {
    const auth = createProviderOAuthAuth({
      providerId: 'anthropic',
      envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    });
    expect(auth.methodId).toBe('anthropic-oauth');
    expect(auth.label).toBe('anthropic OAuth token');
  });

  it('validates when token is in credentials', async () => {
    const auth = createProviderOAuthAuth({
      providerId: 'test',
      envVar: 'TOKEN',
    });
    expect(await auth.validate({ TOKEN: 'sk-ant-oat01-abc' })).toBe(true);
  });

  it('fails for whitespace-only token', async () => {
    const auth = createProviderOAuthAuth({
      providerId: 'test',
      envVar: 'TOKEN',
    });
    expect(await auth.validate({ TOKEN: '   ' })).toBe(false);
  });

  it('validates from env when not in credentials', async () => {
    process.env.MY_TOKEN = 'valid-token';
    const auth = createProviderOAuthAuth({
      providerId: 'test',
      envVar: 'MY_TOKEN',
    });
    expect(await auth.validate({})).toBe(true);
  });
});
