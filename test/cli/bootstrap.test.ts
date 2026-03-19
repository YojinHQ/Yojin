import { describe, expect, it, vi } from 'vitest';

import { type BootstrapDeps, runBootstrap } from '../../src/cli/bootstrap.js';

function createMockDeps(overrides?: Partial<BootstrapDeps>): BootstrapDeps {
  return {
    readSecret: vi.fn().mockResolvedValue('sk-ant-api-test-key'),
    vault: {
      set: vi.fn(),
      get: vi.fn(),
      has: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
    },
    reinitializeProvider: vi.fn().mockResolvedValue(true),
    prompt: vi.fn().mockResolvedValue('1'),
    log: vi.fn(),
    ...overrides,
  };
}

describe('runBootstrap', () => {
  it('stores API key in vault and reinitializes provider on option 1', async () => {
    const deps = createMockDeps();
    const result = await runBootstrap(deps);

    expect(result.success).toBe(true);
    expect(deps.vault.set).toHaveBeenCalledWith('ANTHROPIC_API_KEY', 'sk-ant-api-test-key');
    expect(deps.reinitializeProvider).toHaveBeenCalled();
  });

  it('returns skip when user picks option 3', async () => {
    const deps = createMockDeps({ prompt: vi.fn().mockResolvedValue('3') });
    const result = await runBootstrap(deps);

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
  });

  it('retries on failed provider initialization', async () => {
    let calls = 0;
    const deps = createMockDeps({
      reinitializeProvider: vi.fn().mockImplementation(async () => {
        calls++;
        return calls > 1;
      }),
      prompt: vi
        .fn()
        .mockResolvedValueOnce('1') // first attempt: API key
        .mockResolvedValueOnce('1') // retry: API key again
        .mockResolvedValueOnce('3'), // give up (if needed)
    });

    await runBootstrap(deps);
    expect(deps.readSecret).toHaveBeenCalledTimes(2);
  });
});
