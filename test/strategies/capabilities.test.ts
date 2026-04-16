import { describe, expect, it } from 'vitest';

import {
  DataCapabilitySchema,
  capabilitiesToEnrichmentFields,
  checkCapabilities,
  getAvailableCapabilities,
} from '../../src/strategies/capabilities.js';

describe('DataCapabilitySchema', () => {
  it('validates known capabilities', () => {
    expect(DataCapabilitySchema.parse('market_data')).toBe('market_data');
    expect(DataCapabilitySchema.parse('technicals')).toBe('technicals');
    expect(DataCapabilitySchema.parse('sentiment')).toBe('sentiment');
  });

  it('rejects unknown capabilities', () => {
    expect(() => DataCapabilitySchema.parse('options_chain')).toThrow();
    expect(() => DataCapabilitySchema.parse('')).toThrow();
  });
});

describe('getAvailableCapabilities', () => {
  it('returns a non-empty array of valid capabilities', () => {
    const available = getAvailableCapabilities();
    expect(available.length).toBeGreaterThan(0);
    for (const cap of available) {
      expect(() => DataCapabilitySchema.parse(cap)).not.toThrow();
    }
  });
});

describe('checkCapabilities', () => {
  it('returns all available when requires is empty', () => {
    const result = checkCapabilities([]);
    expect(result.status).toBe('executable');
    expect(result.missing).toEqual([]);
  });

  it('returns executable when all required are available', () => {
    const result = checkCapabilities(['market_data', 'technicals']);
    expect(result.status).toBe('executable');
    expect(result.missing).toEqual([]);
    expect(result.required).toEqual(['market_data', 'technicals']);
  });

  it('returns limited when some required are missing', () => {
    const subset = ['market_data'] as const;
    const result = checkCapabilities(['market_data', 'derivatives'], [...subset]);
    expect(result.status).toBe('limited');
    expect(result.missing).toEqual(['derivatives']);
  });

  it('returns unavailable when all required are missing', () => {
    const subset = ['market_data'] as const;
    const result = checkCapabilities(['derivatives'], [...subset]);
    expect(result.status).toBe('unavailable');
    expect(result.missing).toEqual(['derivatives']);
  });
});

describe('capabilitiesToEnrichmentFields', () => {
  it('maps market_data and fundamentals to market', () => {
    const fields = capabilitiesToEnrichmentFields(['market_data', 'fundamentals']);
    expect(fields).toEqual(['market']);
  });

  it('maps technicals to technicals', () => {
    const fields = capabilitiesToEnrichmentFields(['technicals']);
    expect(fields).toEqual(['technicals']);
  });

  it('maps news, research, sentiment, filings, derivatives', () => {
    const fields = capabilitiesToEnrichmentFields(['news', 'research', 'sentiment', 'filings', 'derivatives']);
    expect(fields).toEqual(
      expect.arrayContaining(['news', 'research', 'sentiment', 'social', 'regulatory', 'derivatives']),
    );
    expect(fields).toHaveLength(6);
  });

  it('returns empty for portfolio-only capabilities', () => {
    const fields = capabilitiesToEnrichmentFields(['portfolio', 'macro_data']);
    expect(fields).toEqual([]);
  });

  it('deduplicates fields when multiple capabilities map to the same field', () => {
    const fields = capabilitiesToEnrichmentFields(['market_data', 'fundamentals', 'technicals']);
    expect(fields.filter((f) => f === 'market')).toHaveLength(1);
    expect(fields).toEqual(expect.arrayContaining(['market', 'technicals']));
  });

  it('returns empty for empty input', () => {
    expect(capabilitiesToEnrichmentFields([])).toEqual([]);
  });
});
