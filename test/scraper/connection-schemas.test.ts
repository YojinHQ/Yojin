import { describe, expect, it } from 'vitest';

import {
  ConnectionConfigSchema,
  ConnectionStateSchema,
  ConnectionStatusSchema,
  ConnectionsFileSchema,
  IntegrationTierSchema,
} from '../../src/scraper/types.js';

describe('IntegrationTierSchema', () => {
  it('accepts valid tiers', () => {
    expect(IntegrationTierSchema.parse('CLI')).toBe('CLI');
    expect(IntegrationTierSchema.parse('API')).toBe('API');
    expect(IntegrationTierSchema.parse('UI')).toBe('UI');
    expect(IntegrationTierSchema.parse('SCREENSHOT')).toBe('SCREENSHOT');
  });

  it('rejects invalid tier', () => {
    expect(() => IntegrationTierSchema.parse('graphql')).toThrow();
  });
});

describe('ConnectionConfigSchema', () => {
  it('validates a complete config entry', () => {
    const result = ConnectionConfigSchema.parse({
      platform: 'COINBASE',
      tier: 'API',
      credentialRefs: ['COINBASE_API_KEY', 'COINBASE_API_SECRET'],
      syncInterval: 1800,
      autoRefresh: true,
    });
    expect(result.platform).toBe('COINBASE');
    expect(result.tier).toBe('API');
    expect(result.credentialRefs).toHaveLength(2);
  });

  it('applies defaults for syncInterval and autoRefresh', () => {
    const result = ConnectionConfigSchema.parse({
      platform: 'COINBASE',
      tier: 'SCREENSHOT',
      credentialRefs: [],
    });
    expect(result.syncInterval).toBe(3600);
    expect(result.autoRefresh).toBe(true);
  });

  it('rejects missing platform', () => {
    expect(() => ConnectionConfigSchema.parse({ tier: 'API', credentialRefs: [] })).toThrow();
  });
});

describe('ConnectionStateSchema', () => {
  it('validates a complete state entry', () => {
    const result = ConnectionStateSchema.parse({
      platform: 'COINBASE',
      tier: 'API',
      status: 'CONNECTED',
      lastSync: '2026-03-19T10:00:00Z',
      lastError: null,
    });
    expect(result.status).toBe('CONNECTED');
  });

  it('accepts all status values', () => {
    for (const status of ['PENDING', 'VALIDATING', 'CONNECTED', 'ERROR', 'DISCONNECTED']) {
      expect(ConnectionStatusSchema.parse(status)).toBe(status);
    }
  });
});

describe('ConnectionsFileSchema', () => {
  it('validates an array of configs', () => {
    const result = ConnectionsFileSchema.parse([
      { platform: 'COINBASE', tier: 'API', credentialRefs: ['COINBASE_API_KEY'] },
      { platform: 'INTERACTIVE_BROKERS', tier: 'UI', credentialRefs: [] },
    ]);
    expect(result).toHaveLength(2);
  });

  it('validates empty array', () => {
    expect(ConnectionsFileSchema.parse([])).toEqual([]);
  });
});
