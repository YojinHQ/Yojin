import { describe, expect, it } from 'vitest';

import { getCredentialRequirements, mergeCredentialOverrides } from '../../src/scraper/platform-credentials.js';

describe('getCredentialRequirements', () => {
  it('returns API credentials for COINBASE', () => {
    const reqs = getCredentialRequirements('COINBASE', 'API');
    expect(reqs).toEqual(['COINBASE_API_KEY', 'COINBASE_API_SECRET']);
  });

  it('returns empty array for SCREENSHOT tier', () => {
    const reqs = getCredentialRequirements('COINBASE', 'SCREENSHOT');
    expect(reqs).toEqual([]);
  });

  it('returns empty array for unknown platform', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reqs = getCredentialRequirements('UNKNOWN_PLATFORM' as any, 'API');
    expect(reqs).toEqual([]);
  });

  it('returns empty array for unsupported tier on known platform', () => {
    const reqs = getCredentialRequirements('MANUAL', 'CLI');
    expect(reqs).toEqual([]);
  });
});

describe('mergeCredentialOverrides', () => {
  it('overrides merge on top of defaults', () => {
    const overrides = {
      COINBASE: { API: ['CUSTOM_KEY'] },
    };
    const merged = mergeCredentialOverrides(overrides);
    expect(merged('COINBASE', 'API')).toEqual(['CUSTOM_KEY']);
    expect(merged('COINBASE', 'UI')).toEqual(['COINBASE_USERNAME', 'COINBASE_PASSWORD']);
  });

  it('returns defaults when no overrides', () => {
    const merged = mergeCredentialOverrides({});
    expect(merged('COINBASE', 'API')).toEqual(['COINBASE_API_KEY', 'COINBASE_API_SECRET']);
  });
});
