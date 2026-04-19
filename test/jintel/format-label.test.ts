import { describe, expect, it } from 'vitest';

import { formatAssetLabel } from '../../src/jintel/format-label.js';

describe('formatAssetLabel', () => {
  it('renders "{name} ({ticker})" when both are distinct', () => {
    expect(formatAssetLabel('Strategy', 'MSTR')).toBe('Strategy (MSTR)');
    expect(formatAssetLabel('Apple Inc.', 'AAPL')).toBe('Apple Inc. (AAPL)');
  });

  it('falls back to ticker when name is missing', () => {
    expect(formatAssetLabel(undefined, 'MSTR')).toBe('MSTR');
    expect(formatAssetLabel(null, 'BTC')).toBe('BTC');
    expect(formatAssetLabel('', 'ETH')).toBe('ETH');
  });

  it('returns the ticker alone when name equals the ticker (case-insensitive)', () => {
    expect(formatAssetLabel('AAPL', 'AAPL')).toBe('AAPL');
    expect(formatAssetLabel('btc', 'BTC')).toBe('BTC');
  });
});
