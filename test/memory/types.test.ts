import { describe, expect, it } from 'vitest';

import {
  GradeSchema,
  MemoryAgentRoleSchema,
  MemoryEntrySchema,
  NewMemoryInputSchema,
  PriceOutcomeSchema,
  ReflectionInputSchema,
} from '../../src/memory/types.js';

describe('MemoryAgentRoleSchema', () => {
  it('accepts valid roles', () => {
    expect(MemoryAgentRoleSchema.parse('analyst')).toBe('analyst');
    expect(MemoryAgentRoleSchema.parse('strategist')).toBe('strategist');
    expect(MemoryAgentRoleSchema.parse('risk-manager')).toBe('risk-manager');
  });

  it('rejects trader (excluded from V1)', () => {
    expect(() => MemoryAgentRoleSchema.parse('trader')).toThrow();
  });

  it('rejects invalid roles', () => {
    expect(() => MemoryAgentRoleSchema.parse('unknown')).toThrow();
  });
});

describe('GradeSchema', () => {
  it('accepts CORRECT, PARTIALLY_CORRECT, INCORRECT', () => {
    expect(GradeSchema.parse('CORRECT')).toBe('CORRECT');
    expect(GradeSchema.parse('PARTIALLY_CORRECT')).toBe('PARTIALLY_CORRECT');
    expect(GradeSchema.parse('INCORRECT')).toBe('INCORRECT');
  });

  it('rejects lowercase', () => {
    expect(() => GradeSchema.parse('correct')).toThrow();
  });
});

describe('MemoryEntrySchema', () => {
  const validEntry = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    agentRole: 'analyst',
    tickers: ['AAPL'],
    situation: 'RSI oversold after earnings beat',
    recommendation: 'Bullish — expect 5% upside',
    confidence: 0.8,
    createdAt: '2026-03-22T10:00:00Z',
    outcome: null,
    lesson: null,
    actualReturn: null,
    grade: null,
    reflectedAt: null,
  };

  it('accepts a valid unreflected entry', () => {
    expect(MemoryEntrySchema.parse(validEntry)).toEqual(validEntry);
  });

  it('accepts a valid reflected entry', () => {
    const reflected = {
      ...validEntry,
      outcome: 'AAPL dropped 3% due to macro selloff',
      lesson: 'RSI oversold is unreliable when VIX is elevated',
      actualReturn: -3.0,
      grade: 'INCORRECT',
      reflectedAt: '2026-03-29T10:00:00Z',
    };
    expect(MemoryEntrySchema.parse(reflected)).toEqual(reflected);
  });

  it('rejects empty id', () => {
    expect(() => MemoryEntrySchema.parse({ ...validEntry, id: '' })).toThrow();
  });

  it('rejects empty tickers array', () => {
    expect(() => MemoryEntrySchema.parse({ ...validEntry, tickers: [] })).toThrow();
  });

  it('rejects confidence out of range', () => {
    expect(() => MemoryEntrySchema.parse({ ...validEntry, confidence: 1.5 })).toThrow();
    expect(() => MemoryEntrySchema.parse({ ...validEntry, confidence: -0.1 })).toThrow();
  });
});

describe('NewMemoryInputSchema', () => {
  it('accepts valid input without id/reflection fields', () => {
    const input = {
      tickers: ['MSFT'],
      situation: 'Tech sector rotation',
      recommendation: 'Bullish on MSFT',
      confidence: 0.7,
    };
    expect(NewMemoryInputSchema.parse(input)).toEqual(input);
  });
});

describe('ReflectionInputSchema', () => {
  it('accepts valid reflection', () => {
    const input = {
      outcome: 'Price rose 5%',
      lesson: 'Earnings beat in risk-on macro is reliable',
      actualReturn: 5.0,
      grade: 'CORRECT',
    };
    expect(ReflectionInputSchema.parse(input)).toEqual(input);
  });
});

describe('PriceOutcomeSchema', () => {
  it('accepts valid price outcome', () => {
    const input = {
      priceAtAnalysis: 150.0,
      priceNow: 155.0,
      returnPct: 3.33,
      highInPeriod: 158.0,
      lowInPeriod: 148.0,
    };
    expect(PriceOutcomeSchema.parse(input)).toEqual(input);
  });
});
