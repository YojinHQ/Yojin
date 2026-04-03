import { describe, it, expect } from 'vitest';
import { formatPrice } from './format';

describe('formatPrice', () => {
  describe('>= $1,000: no decimals, truncated', () => {
    it('formats $1,000 with no decimals', () => {
      expect(formatPrice(1000)).toBe('$1,000');
    });

    it('truncates $1,000.99 to $1,000', () => {
      expect(formatPrice(1000.99)).toBe('$1,000');
    });

    it('truncates $2,019.45 to $2,019', () => {
      expect(formatPrice(2019.45)).toBe('$2,019');
    });

    it('formats $66,369.00 as $66,369', () => {
      expect(formatPrice(66369)).toBe('$66,369');
    });
  });

  describe('< $1,000, no fractional part: no decimals', () => {
    it('formats $82 with no decimals', () => {
      expect(formatPrice(82)).toBe('$82');
    });

    it('formats $19 with no decimals', () => {
      expect(formatPrice(19)).toBe('$19');
    });

    it('formats $0 as $0', () => {
      expect(formatPrice(0)).toBe('$0');
    });
  });

  describe('< $1,000, trailing zero in cents: 1 decimal', () => {
    it('formats $82.50 as $82.5', () => {
      expect(formatPrice(82.5)).toBe('$82.5');
    });

    it('formats $353.10 as $353.1', () => {
      expect(formatPrice(353.1)).toBe('$353.1');
    });
  });

  describe('< $1,000, no trailing zero: 2 decimals', () => {
    it('formats $82.43 as $82.43', () => {
      expect(formatPrice(82.43)).toBe('$82.43');
    });

    it('formats $19.38 as $19.38', () => {
      expect(formatPrice(19.38)).toBe('$19.38');
    });
  });

  describe('> 0 and < $0.01: up to 4 decimals, trim trailing zeros', () => {
    it('formats $0.0004 as $0.0004', () => {
      expect(formatPrice(0.0004)).toBe('$0.0004');
    });

    it('formats $0.00045 as $0.0005 (Intl rounds at 4 decimals)', () => {
      expect(formatPrice(0.00045)).toBe('$0.0005');
    });

    it('formats $0.0012 as $0.0012', () => {
      expect(formatPrice(0.0012)).toBe('$0.0012');
    });
  });

  describe('negative values', () => {
    it('formats -$82.43 correctly', () => {
      expect(formatPrice(-82.43)).toBe('-$82.43');
    });
  });

  describe('boundary values', () => {
    it('formats $999.99 as $999.99 (stays in < $1,000 branch)', () => {
      expect(formatPrice(999.99)).toBe('$999.99');
    });
  });
});
