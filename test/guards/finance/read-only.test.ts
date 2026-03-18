import { describe, expect, it } from 'vitest';

import { ReadOnlyGuard } from '../../../src/guards/finance/read-only.js';
import type { ProposedAction } from '../../../src/guards/types.js';

describe('ReadOnlyGuard', () => {
  it('passes all actions when disabled', () => {
    const guard = new ReadOnlyGuard({ enabled: false });
    expect(guard.check({ type: 'trade', symbol: 'AAPL' }).pass).toBe(true);
    expect(guard.check({ type: 'write' }).pass).toBe(true);
  });

  it('blocks trade actions when enabled', () => {
    const guard = new ReadOnlyGuard({ enabled: true });
    const result = guard.check({ type: 'trade', symbol: 'AAPL' });
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('Read-only mode');
    }
  });

  it('blocks write/delete/create/update when enabled', () => {
    const guard = new ReadOnlyGuard({ enabled: true });
    for (const type of ['write', 'delete', 'create', 'update']) {
      expect(guard.check({ type } as ProposedAction).pass).toBe(false);
    }
  });

  it('allows read actions when enabled', () => {
    const guard = new ReadOnlyGuard({ enabled: true });
    expect(guard.check({ type: 'tool_call' }).pass).toBe(true);
    expect(guard.check({ type: 'file_access' }).pass).toBe(true);
    expect(guard.check({ type: 'network_request' }).pass).toBe(true);
  });

  it('setEnabled toggles behavior', () => {
    const guard = new ReadOnlyGuard({ enabled: false });
    expect(guard.check({ type: 'trade' }).pass).toBe(true);

    guard.setEnabled(true);
    expect(guard.check({ type: 'trade' }).pass).toBe(false);

    guard.setEnabled(false);
    expect(guard.check({ type: 'trade' }).pass).toBe(true);
  });
});
