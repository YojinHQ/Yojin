import { describe, expect, it } from 'vitest';

import { parseCallbackData } from '../../channels/telegram/src/bot.js';

describe('parseCallbackData', () => {
  it('parses approve callback', () => {
    const result = parseCallbackData('approve:req-123');
    expect(result).toEqual({ action: 'approve', id: 'req-123' });
  });

  it('parses reject callback', () => {
    const result = parseCallbackData('reject:req-456');
    expect(result).toEqual({ action: 'reject', id: 'req-456' });
  });

  it('parses details callback', () => {
    const result = parseCallbackData('details:req-789');
    expect(result).toEqual({ action: 'details', id: 'req-789' });
  });

  it('parses action-approve callback', () => {
    const result = parseCallbackData('action-approve:act-1');
    expect(result).toEqual({ action: 'action-approve', id: 'act-1' });
  });

  it('parses action-reject callback', () => {
    const result = parseCallbackData('action-reject:act-2');
    expect(result).toEqual({ action: 'action-reject', id: 'act-2' });
  });

  it('returns null for malformed data', () => {
    expect(parseCallbackData('')).toBeNull();
    expect(parseCallbackData('invalid')).toBeNull();
    expect(parseCallbackData('unknown:id')).toBeNull();
  });

  it('handles IDs containing colons', () => {
    const result = parseCallbackData('approve:uuid:with:colons');
    expect(result).toEqual({ action: 'approve', id: 'uuid:with:colons' });
  });
});
