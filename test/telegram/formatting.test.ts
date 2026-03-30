import { describe, expect, it } from 'vitest';

import { chunkMessage, escapeMarkdownV2, formatAction, formatSnap } from '../../channels/telegram/src/formatting.js';
import type { Action } from '../../src/actions/types.js';
import type { Snap } from '../../src/snap/types.js';

describe('escapeMarkdownV2', () => {
  it('escapes special characters', () => {
    expect(escapeMarkdownV2('Hello_World')).toBe('Hello\\_World');
    expect(escapeMarkdownV2('Price: $182.50')).toBe('Price: $182\\.50');
    expect(escapeMarkdownV2('BRK.B (+2.3%)')).toBe('BRK\\.B \\(\\+2\\.3%\\)');
  });

  it('handles empty string', () => {
    expect(escapeMarkdownV2('')).toBe('');
  });

  it('escapes all MarkdownV2 special chars', () => {
    const special = '_*[]()~`>#+-=|{}.!';
    const escaped = escapeMarkdownV2(special);
    expect(escaped).toBe('\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!');
  });
});

describe('chunkMessage', () => {
  it('returns single chunk for short messages', () => {
    const chunks = chunkMessage('Hello', 4096);
    expect(chunks).toEqual(['Hello']);
  });

  it('splits at paragraph boundaries', () => {
    const para1 = 'A'.repeat(3000);
    const para2 = 'B'.repeat(3000);
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkMessage(text, 4096);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(para1);
    expect(chunks[1]).toBe(para2);
  });

  it('splits at newline boundaries when no paragraph break fits', () => {
    const line1 = 'A'.repeat(3000);
    const line2 = 'B'.repeat(3000);
    const text = `${line1}\n${line2}`;
    const chunks = chunkMessage(text, 4096);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(line1);
    expect(chunks[1]).toBe(line2);
  });

  it('hard-cuts when no boundary exists', () => {
    const text = 'A'.repeat(5000);
    const chunks = chunkMessage(text, 4096);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(4096);
    expect(chunks[1]).toHaveLength(904);
  });
});

describe('formatSnap', () => {
  it('formats a snap brief with attention items', () => {
    const snap: Snap = {
      id: 'snap-1',
      generatedAt: '2026-03-30T08:00:00Z',
      summary: 'Markets are mixed. Tech rallying, energy weak.',
      attentionItems: [
        { label: 'AAPL earnings beat expectations', severity: 'HIGH', ticker: 'AAPL' },
        { label: 'Oil prices declining', severity: 'MEDIUM' },
        { label: 'Fed meeting minutes released', severity: 'LOW' },
      ],
      portfolioTickers: ['AAPL', 'MSFT', 'XOM'],
    };

    const result = formatSnap(snap);
    expect(result).toContain('Snap Brief');
    expect(result).toContain('AAPL earnings beat expectations');
    expect(result).toContain('\u{1F534}');
  });
});

describe('formatAction', () => {
  it('formats a pending action', () => {
    const action: Action = {
      id: 'act-1',
      what: 'Review AAPL — bearish divergence detected',
      why: 'RSI divergence on daily chart',
      source: 'skill: momentum',
      status: 'PENDING',
      expiresAt: '2026-03-31T08:00:00Z',
      createdAt: '2026-03-30T08:00:00Z',
    };

    const result = formatAction(action);
    expect(result).toContain('Review AAPL');
    expect(result).toContain('RSI divergence');
    expect(result).toContain('momentum');
  });
});
