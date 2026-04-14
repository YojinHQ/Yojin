import { describe, expect, it } from 'vitest';

import { parseFromMarkdown, serializeToMarkdown } from '../../src/strategies/strategy-serializer.js';

const VALID_MD = `---
name: Price Momentum
description: Go long stocks with strong 12-month returns
category: MARKET
style: momentum
requires:
  - market_data
triggerGroups:
  - conditions:
      - type: PRICE_MOVE
        description: 12-month return exceeds 15%
        params:
          threshold: 0.15
          direction: above
tickers: []
maxPositionSize: 0.05
---

## Thesis
Stocks with strong momentum tend to continue outperforming.

## Entry Rules
- Formation period: 12 months
- Go long top decile
`;

const LEGACY_MD = `---
name: Price Momentum
description: Go long stocks with strong 12-month returns
category: MARKET
style: momentum
requires:
  - market_data
triggers:
  - type: PRICE_MOVE
    description: 12-month return exceeds 15%
    params:
      threshold: 0.15
      direction: above
tickers: []
maxPositionSize: 0.05
---

## Thesis
Stocks with strong momentum tend to continue outperforming.

## Entry Rules
- Formation period: 12 months
- Go long top decile
`;

describe('parseFromMarkdown', () => {
  it('parses valid markdown into a Strategy', () => {
    const strategy = parseFromMarkdown(VALID_MD);
    expect(strategy.name).toBe('Price Momentum');
    expect(strategy.description).toBe('Go long stocks with strong 12-month returns');
    expect(strategy.category).toBe('MARKET');
    expect(strategy.style).toBe('momentum');
    expect(strategy.requires).toEqual(['market_data']);
    expect(strategy.triggerGroups).toHaveLength(1);
    expect(strategy.triggerGroups[0].conditions).toHaveLength(1);
    expect(strategy.triggerGroups[0].conditions[0].type).toBe('PRICE_MOVE');
    expect(strategy.triggerGroups[0].conditions[0].params).toEqual({ threshold: 0.15, direction: 'above' });
    expect(strategy.tickers).toEqual([]);
    expect(strategy.maxPositionSize).toBe(0.05);
    expect(strategy.source).toBe('community');
    expect(strategy.active).toBe(false);
    expect(strategy.content).toContain('## Thesis');
    expect(strategy.content).toContain('## Entry Rules');
  });

  it('generates id from slugified name', () => {
    const strategy = parseFromMarkdown(VALID_MD);
    expect(strategy.id).toBe('price-momentum');
  });

  it('throws on missing required frontmatter fields', () => {
    const bad = `---
name: Test
---
Body here`;
    expect(() => parseFromMarkdown(bad)).toThrow();
  });

  it('throws on unknown capability in requires', () => {
    const bad = VALID_MD.replace('market_data', 'options_chain');
    expect(() => parseFromMarkdown(bad)).toThrow();
  });

  it('throws on invalid trigger type', () => {
    const bad = VALID_MD.replace('PRICE_MOVE', 'INVALID_TYPE');
    expect(() => parseFromMarkdown(bad)).toThrow();
  });

  it('throws on missing frontmatter delimiters', () => {
    expect(() => parseFromMarkdown('no frontmatter here')).toThrow();
  });

  it('defaults requires to empty array when omitted', () => {
    const md = `---
name: Simple Strategy
description: A test
category: RISK
style: defensive
triggers:
  - type: DRAWDOWN
    description: Drawdown exceeds threshold
tickers: []
---

Body content here.`;
    const strategy = parseFromMarkdown(md);
    expect(strategy.requires).toEqual([]);
  });
});

describe('serializeToMarkdown', () => {
  it('round-trips: parse then serialize produces valid markdown', () => {
    const strategy = parseFromMarkdown(VALID_MD);
    const md = serializeToMarkdown(strategy);

    expect(md).toContain('name: Price Momentum');
    expect(md).toContain('category: MARKET');
    expect(md).toContain('style: momentum');
    expect(md).toContain('market_data');
    expect(md).toContain('PRICE_MOVE');
    expect(md).toContain('## Thesis');
    expect(md).toContain('## Entry Rules');
  });

  it('excludes internal fields from frontmatter', () => {
    const strategy = parseFromMarkdown(VALID_MD);
    const md = serializeToMarkdown(strategy);

    expect(md).not.toContain('id:');
    expect(md).not.toContain('active:');
    expect(md).not.toContain('source:');
    expect(md).not.toContain('createdBy:');
    expect(md).not.toContain('createdAt:');
  });

  it('re-parsed output matches original strategy fields', () => {
    const original = parseFromMarkdown(VALID_MD);
    const md = serializeToMarkdown(original);
    const reparsed = parseFromMarkdown(md);

    expect(reparsed.name).toBe(original.name);
    expect(reparsed.category).toBe(original.category);
    expect(reparsed.style).toBe(original.style);
    expect(reparsed.requires).toEqual(original.requires);
    expect(reparsed.triggerGroups).toEqual(original.triggerGroups);
    expect(reparsed.content.trim()).toBe(original.content.trim());
  });

  it('serializes triggerGroups (not triggers) in frontmatter', () => {
    const strategy = parseFromMarkdown(VALID_MD);
    const md = serializeToMarkdown(strategy);
    expect(md).toContain('triggerGroups:');
    expect(md).not.toContain('triggers:');
  });
});

describe('strategy-serializer triggerGroups', () => {
  it('serializes and parses triggerGroups round-trip', () => {
    const strategy = {
      id: 'test',
      name: 'Test Strategy',
      description: 'Test desc',
      category: 'MARKET' as const,
      style: 'momentum',
      requires: ['technicals' as const],
      active: false,
      source: 'custom' as const,
      createdBy: 'test',
      createdAt: '2026-01-01T00:00:00.000Z',
      content: '# Strategy\nBuy low sell high.',
      triggerGroups: [
        {
          label: 'Entry',
          conditions: [
            {
              type: 'INDICATOR_THRESHOLD' as const,
              description: 'RSI below 30',
              params: { indicator: 'RSI', threshold: 30, direction: 'below' },
            },
            { type: 'PRICE_MOVE' as const, description: 'Drop > 5%', params: { threshold: -0.05 } },
          ],
        },
        {
          label: '',
          conditions: [{ type: 'DRAWDOWN' as const, description: 'Drawdown > 10%', params: { threshold: -0.1 } }],
        },
      ],
      tickers: ['AAPL'],
      assetClasses: [],
    };

    const md = serializeToMarkdown(strategy);
    expect(md).toContain('triggerGroups:');
    expect(md).not.toContain('triggers:');

    const parsed = parseFromMarkdown(md);
    expect(parsed.triggerGroups).toHaveLength(2);
    expect(parsed.triggerGroups[0].label).toBe('Entry');
    expect(parsed.triggerGroups[0].conditions).toHaveLength(2);
    expect(parsed.triggerGroups[1].conditions).toHaveLength(1);
  });

  it('parses old triggers format as fallback', () => {
    const parsed = parseFromMarkdown(LEGACY_MD);
    expect(parsed.triggerGroups).toHaveLength(1);
    expect(parsed.triggerGroups[0].conditions[0].type).toBe('PRICE_MOVE');
  });
});
