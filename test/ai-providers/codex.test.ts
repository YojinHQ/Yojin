import { describe, expect, it } from 'vitest';

import { CodexProvider } from '../../src/ai-providers/codex.js';

describe('CodexProvider', () => {
  it('has correct id and name', () => {
    const provider = new CodexProvider();
    expect(provider.id).toBe('codex');
    expect(provider.name).toBe('Codex');
  });

  it('lists models from supported SDK families', () => {
    const provider = new CodexProvider();
    const models = provider.models();
    expect(models.length).toBeGreaterThan(0);
  });

  it('isAvailable returns boolean', async () => {
    const provider = new CodexProvider();
    const available = await provider.isAvailable();
    expect(typeof available).toBe('boolean');
  });
});
