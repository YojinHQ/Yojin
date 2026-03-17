/**
 * SymbolWhitelistGuard — restricts actions to approved instruments only.
 *
 * Empty whitelist = allow all (opt-in restriction).
 */

import type { Guard, GuardResult, ProposedAction } from '../types.js';

export class SymbolWhitelistGuard implements Guard {
  readonly name = 'symbol-whitelist';
  private symbols: Set<string>;

  constructor(options?: { symbols?: string[] }) {
    this.symbols = new Set((options?.symbols ?? []).map((s) => s.toUpperCase()));
  }

  check(action: ProposedAction): GuardResult {
    if (!action.symbol) return { pass: true };

    // Empty whitelist = allow all
    if (this.symbols.size === 0) return { pass: true };

    const normalized = action.symbol.toUpperCase();
    if (!this.symbols.has(normalized)) {
      return {
        pass: false,
        reason: `Symbol not whitelisted: ${action.symbol}`,
      };
    }

    return { pass: true };
  }

  updateWhitelist(symbols: string[]): void {
    this.symbols = new Set(symbols.map((s) => s.toUpperCase()));
  }
}
