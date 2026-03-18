import { afterEach, describe, expect, it } from 'vitest';

import { KillSwitch } from '../../../src/guards/security/kill-switch.js';
import type { ProposedAction } from '../../../src/guards/types.js';

function action(): ProposedAction {
  return { type: 'tool_call', toolName: 'test' };
}

describe('KillSwitch', () => {
  afterEach(() => {
    delete process.env.YOJIN_KILL_SWITCH;
  });

  it('passes when not tripped', () => {
    const ks = new KillSwitch({ sentinelPath: '/nonexistent/.kill' });
    expect(ks.check(action()).pass).toBe(true);
  });

  it('blocks when programmatically tripped', () => {
    const ks = new KillSwitch({ sentinelPath: '/nonexistent/.kill' });
    ks.trip('detected attack');

    const result = ks.check(action());
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('detected attack');
    }
  });

  it('blocks when env var is set', () => {
    process.env.YOJIN_KILL_SWITCH = '1';
    const ks = new KillSwitch({ sentinelPath: '/nonexistent/.kill' });

    const result = ks.check(action());
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('YOJIN_KILL_SWITCH');
    }
  });

  it('reset clears programmatic trip', () => {
    const ks = new KillSwitch({ sentinelPath: '/nonexistent/.kill' });
    ks.trip('test');
    expect(ks.check(action()).pass).toBe(false);

    ks.reset();
    expect(ks.check(action()).pass).toBe(true);
  });

  it('isTripped reflects current state', () => {
    const ks = new KillSwitch({ sentinelPath: '/nonexistent/.kill' });
    expect(ks.isTripped()).toBe(false);

    ks.trip('test');
    expect(ks.isTripped()).toBe(true);

    ks.reset();
    expect(ks.isTripped()).toBe(false);
  });

  it('supports custom env var name', () => {
    process.env.CUSTOM_KILL = '1';
    const ks = new KillSwitch({
      envVar: 'CUSTOM_KILL',
      sentinelPath: '/nonexistent/.kill',
    });

    expect(ks.check(action()).pass).toBe(false);
    delete process.env.CUSTOM_KILL;
  });
});
