import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderRouter } from '../../src/ai-providers/router.js';
import type { AIProvider } from '../../src/ai-providers/types.js';

function mockBackend(id: string, responseText = 'hello'): AIProvider {
  return {
    id,
    name: `Mock ${id}`,
    models: () => ['mock-model'],
    isAvailable: vi.fn(async () => true),
    completeWithTools: vi.fn(async () => ({
      content: [{ type: 'text' as const, text: responseText }],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
    })),
  };
}

describe('ProviderRouter', () => {
  let router: ProviderRouter;
  let backend: AIProvider;

  beforeEach(() => {
    backend = mockBackend('test-backend');
    router = new ProviderRouter({ configPath: 'nonexistent.json' });
    router.registerBackend(backend);
    router.setConfig({ defaultProvider: 'test-backend', defaultModel: 'mock-model' });
  });

  it('resolves to registered backend', () => {
    const resolved = router.resolve();
    expect(resolved.provider.id).toBe('test-backend');
  });

  it('throws when named provider is not registered', () => {
    expect(() => router.resolve({ provider: 'nonexistent' })).toThrow('AI provider "nonexistent" is not registered');
  });

  it('respects per-agent profile override', () => {
    const alt = mockBackend('alt-backend');
    router.registerBackend(alt);
    const resolved = router.resolve({ provider: 'alt-backend', model: 'custom-model' });
    expect(resolved.provider.id).toBe('alt-backend');
    expect(resolved.model).toBe('custom-model');
  });

  it('completeWithTools delegates to resolved backend', async () => {
    const result = await router.completeWithTools({
      model: 'mock-model',
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(result.content[0]).toEqual({ type: 'text', text: 'hello' });
    expect(backend.completeWithTools).toHaveBeenCalled();
  });

  it('falls back on primary failure when fallback configured', async () => {
    const failing = mockBackend('primary');
    failing.completeWithTools = vi.fn(async () => {
      throw new Error('network error');
    });
    const fallback = mockBackend('fallback', 'fallback response');

    const r = new ProviderRouter({ configPath: 'nonexistent.json' });
    r.registerBackend(failing);
    r.registerBackend(fallback);
    r.setConfig({
      defaultProvider: 'primary',
      defaultModel: 'm',
      fallbackProvider: 'fallback',
      fallbackModel: 'm',
    });

    const result = await r.completeWithTools({
      model: 'm',
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(result.content[0]).toEqual({ type: 'text', text: 'fallback response' });
  });

  it('does not fall back on 4xx errors', async () => {
    const failing = mockBackend('primary');
    failing.completeWithTools = vi.fn(async () => {
      throw new Error('401 Unauthorized');
    });
    const fallback = mockBackend('fallback', 'fallback');

    const r = new ProviderRouter({ configPath: 'nonexistent.json' });
    r.registerBackend(failing);
    r.registerBackend(fallback);
    r.setConfig({
      defaultProvider: 'primary',
      defaultModel: 'm',
      fallbackProvider: 'fallback',
      fallbackModel: 'm',
    });

    await expect(r.completeWithTools({ model: 'm', messages: [{ role: 'user', content: 'test' }] })).rejects.toThrow(
      '401',
    );
  });
});

describe('ProviderRouter model tier resolution', () => {
  function mockBackendWithId(id: string): AIProvider {
    return {
      id,
      name: `Mock ${id}`,
      models: () => ['mock-model'],
      isAvailable: vi.fn(async () => true),
      completeWithTools: vi.fn(async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
    };
  }

  it('resolves Claude tier aliases to Claude model IDs', () => {
    const router = new ProviderRouter({ configPath: 'nonexistent.json' });
    router.registerBackend(mockBackendWithId('claude-code'));
    router.setConfig({ defaultProvider: 'claude-code', defaultModel: 'claude-opus-4-6' });

    expect(router.resolve({ model: 'haiku' }).model).toBe('claude-haiku-4-5-20251001');
    expect(router.resolve({ model: 'sonnet' }).model).toBe('claude-sonnet-4-6');
    expect(router.resolve({ model: 'opus' }).model).toBe('claude-opus-4-6');
  });

  it('resolves tier aliases to Codex model IDs when codex is active', () => {
    const router = new ProviderRouter({ configPath: 'nonexistent.json' });
    router.registerBackend(mockBackendWithId('codex'));
    router.setConfig({ defaultProvider: 'codex', defaultModel: 'gpt-5.4' });

    expect(router.resolve({ model: 'haiku' }).model).toBe('gpt-5.1-codex-mini');
    expect(router.resolve({ model: 'sonnet' }).model).toBe('gpt-5.4-mini');
    expect(router.resolve({ model: 'opus' }).model).toBe('gpt-5.4');
  });

  it('passes through concrete model IDs unchanged', () => {
    const router = new ProviderRouter({ configPath: 'nonexistent.json' });
    router.registerBackend(mockBackendWithId('claude-code'));
    router.setConfig({ defaultProvider: 'claude-code', defaultModel: 'claude-opus-4-6' });

    expect(router.resolve({ model: 'claude-sonnet-4-6' }).model).toBe('claude-sonnet-4-6');
    expect(router.resolve({ model: 'gpt-5.4' }).model).toBe('gpt-5.4');
  });

  it('passes through unknown aliases unchanged', () => {
    const router = new ProviderRouter({ configPath: 'nonexistent.json' });
    router.registerBackend(mockBackendWithId('claude-code'));
    router.setConfig({ defaultProvider: 'claude-code', defaultModel: 'claude-opus-4-6' });

    expect(router.resolve({ model: 'unknown-model' }).model).toBe('unknown-model');
  });

  it('resolves tiers via provider override, not default provider', () => {
    const router = new ProviderRouter({ configPath: 'nonexistent.json' });
    router.registerBackend(mockBackendWithId('claude-code'));
    router.registerBackend(mockBackendWithId('codex'));
    router.setConfig({ defaultProvider: 'claude-code', defaultModel: 'claude-opus-4-6' });

    // Explicitly override to codex — tier should resolve to codex model
    const resolved = router.resolve({ provider: 'codex', model: 'haiku' });
    expect(resolved.provider.id).toBe('codex');
    expect(resolved.model).toBe('gpt-5.1-codex-mini');
  });

  it('resolves tiers for unknown provider as passthrough', () => {
    const router = new ProviderRouter({ configPath: 'nonexistent.json' });
    router.registerBackend(mockBackendWithId('custom'));
    router.setConfig({ defaultProvider: 'custom', defaultModel: 'custom-model' });

    // No tier mapping for 'custom' provider — alias passes through
    expect(router.resolve({ model: 'haiku' }).model).toBe('haiku');
  });

  it('resolves tier from params.model in completeWithTools', async () => {
    const codex = mockBackendWithId('codex');
    const router = new ProviderRouter({ configPath: 'nonexistent.json' });
    router.registerBackend(codex);
    router.setConfig({ defaultProvider: 'codex', defaultModel: 'gpt-5.4' });

    await router.completeWithTools({
      model: 'haiku',
      messages: [{ role: 'user', content: 'test' }],
    });

    // params.model 'haiku' should be resolved to 'gpt-5.1-codex-mini', not ignored
    expect(codex.completeWithTools).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.1-codex-mini' }));
  });

  it('providerOverrides.model takes precedence over params.model', async () => {
    const codex = mockBackendWithId('codex');
    const router = new ProviderRouter({ configPath: 'nonexistent.json' });
    router.registerBackend(codex);
    router.setConfig({ defaultProvider: 'codex', defaultModel: 'gpt-5.4' });

    await router.completeWithTools({
      model: 'haiku',
      messages: [{ role: 'user', content: 'test' }],
      providerOverrides: { model: 'sonnet' },
    });

    // providerOverrides.model wins over params.model
    expect(codex.completeWithTools).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.4-mini' }));
  });
});

describe('ProviderRouter config loading', () => {
  const tmpDir = path.resolve('test/ai-providers/.tmp-config');
  const configFile = path.join(tmpDir, 'ai-provider.json');

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loadConfig reads config from file and applies it', async () => {
    await writeFile(
      configFile,
      JSON.stringify({
        defaultProvider: 'openai',
        defaultModel: 'gpt-4o',
      }),
    );

    const router = new ProviderRouter({ configPath: configFile });
    const backend = {
      id: 'openai',
      name: 'Mock OpenAI',
      models: () => ['gpt-4o'],
      isAvailable: vi.fn(async () => true),
      completeWithTools: vi.fn(async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      })),
    };
    router.registerBackend(backend);

    const config = await router.loadConfig();
    expect(config.defaultProvider).toBe('openai');
    expect(config.defaultModel).toBe('gpt-4o');

    const resolved = router.resolve();
    expect(resolved.provider.id).toBe('openai');
    expect(resolved.model).toBe('gpt-4o');
  });

  it('loadConfig returns schema defaults when file is missing', async () => {
    const router = new ProviderRouter({ configPath: path.join(tmpDir, 'missing.json') });
    const config = await router.loadConfig();
    expect(config.defaultProvider).toBe('claude-code');
    expect(config.defaultModel).toBe('claude-opus-4-6');
  });

  it('startConfigRefresh periodically reloads config', async () => {
    await writeFile(configFile, JSON.stringify({ defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-6' }));

    const router = new ProviderRouter({ configPath: configFile });
    await router.loadConfig();

    // Spy on loadConfig to verify it gets called by the interval
    const loadSpy = vi.spyOn(router, 'loadConfig');

    router.startConfigRefresh(50);

    // Wait for at least one tick
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(loadSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

    router.stopConfigRefresh();
    loadSpy.mockRestore();
  });

  it('stopConfigRefresh clears the timer', () => {
    const router = new ProviderRouter({ configPath: configFile });
    router.startConfigRefresh(5000);
    // Should not throw
    router.stopConfigRefresh();
    // Double-stop should be safe
    router.stopConfigRefresh();
  });

  it('config refresh survives file errors gracefully', async () => {
    await writeFile(configFile, JSON.stringify({ defaultProvider: 'anthropic', defaultModel: 'claude-opus-4-6' }));

    const router = new ProviderRouter({ configPath: configFile });
    await router.loadConfig();

    // Delete the config dir so next load would fail with invalid JSON path
    await rm(tmpDir, { recursive: true, force: true });
    // But since missing file returns defaults, loadConfig should still succeed
    const config = await router.loadConfig();
    expect(config.defaultProvider).toBe('claude-code');

    router.stopConfigRefresh();
  });
});
