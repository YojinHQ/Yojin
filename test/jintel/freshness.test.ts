import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isShortInterestFresh } from '../../src/jintel/freshness.js';

describe('isShortInterestFresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false when the date is null or undefined', () => {
    expect(isShortInterestFresh(null)).toBe(false);
    expect(isShortInterestFresh(undefined)).toBe(false);
  });

  it('returns false when the date is unparseable', () => {
    expect(isShortInterestFresh('not-a-date')).toBe(false);
  });

  it('returns true when the date is within the 45-day window', () => {
    expect(isShortInterestFresh('2026-04-01')).toBe(true); // 15 days old
    expect(isShortInterestFresh('2026-03-10')).toBe(true); // 37 days old
  });

  it('returns false when the date is older than 45 days', () => {
    expect(isShortInterestFresh('2026-02-28')).toBe(false); // 47 days old
    expect(isShortInterestFresh('2019-11-29')).toBe(false); // the TSLA case
  });

  it('returns true exactly at the 45-day boundary', () => {
    expect(isShortInterestFresh('2026-03-02T12:00:00Z')).toBe(true);
  });
});
