import { describe, expect, it } from 'vitest';

import { SymbolWhitelistGuard } from '../../../src/guards/finance/symbol-whitelist.js';

describe('SymbolWhitelistGuard', () => {
  it('passes when no symbol', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['AAPL'] });
    expect(guard.check({ type: 'tool_call' }).pass).toBe(true);
  });

  it('allows all when whitelist is empty', () => {
    const guard = new SymbolWhitelistGuard();
    expect(guard.check({ type: 'trade', symbol: 'AAPL' }).pass).toBe(true);
    expect(guard.check({ type: 'trade', symbol: 'ANYTHING' }).pass).toBe(true);
  });

  it('allows whitelisted symbols', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['AAPL', 'GOOG', 'MSFT'] });
    expect(guard.check({ type: 'trade', symbol: 'AAPL' }).pass).toBe(true);
    expect(guard.check({ type: 'trade', symbol: 'GOOG' }).pass).toBe(true);
  });

  it('blocks non-whitelisted symbols', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['AAPL'] });
    const result = guard.check({ type: 'trade', symbol: 'TSLA' });
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('TSLA');
    }
  });

  it('is case-insensitive', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['aapl'] });
    expect(guard.check({ type: 'trade', symbol: 'AAPL' }).pass).toBe(true);
    expect(guard.check({ type: 'trade', symbol: 'aapl' }).pass).toBe(true);
  });

  it('updateWhitelist replaces the list', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['AAPL'] });
    expect(guard.check({ type: 'trade', symbol: 'TSLA' }).pass).toBe(false);

    guard.updateWhitelist(['TSLA', 'AAPL']);
    expect(guard.check({ type: 'trade', symbol: 'TSLA' }).pass).toBe(true);
  });
});
