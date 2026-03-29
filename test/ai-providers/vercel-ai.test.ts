import { describe, expect, it } from 'vitest';

import { VercelAIProvider } from '../../src/ai-providers/vercel-ai.js';

describe('VercelAIProvider', () => {
  it('has correct id and name', () => {
    const provider = new VercelAIProvider();
    expect(provider.id).toBe('codex');
    expect(provider.name).toBe('Codex');
  });

  it('lists models from supported SDK families', () => {
    const provider = new VercelAIProvider();
    const models = provider.models();
    expect(models.length).toBeGreaterThan(0);
  });

  it('isAvailable returns boolean', async () => {
    const provider = new VercelAIProvider();
    const available = await provider.isAvailable();
    expect(typeof available).toBe('boolean');
  });
});
