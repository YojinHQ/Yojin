import { describe, expect, it } from 'vitest';

import { EgressGuard } from '../../../src/guards/security/egress-guard.js';
import type { ProposedAction } from '../../../src/guards/types.js';

function action(url: string): ProposedAction {
  return { type: 'network_request', url };
}

describe('EgressGuard', () => {
  const guard = new EgressGuard({
    allowedDomains: ['api.anthropic.com', 'api.jintel.dev', 'localhost'],
  });

  it('passes when no url in action', () => {
    expect(guard.check({ type: 'tool_call' }).pass).toBe(true);
  });

  it('passes allowed domains', () => {
    expect(guard.check(action('https://api.anthropic.com/v1/messages')).pass).toBe(true);
    expect(guard.check(action('https://api.jintel.dev/graphql')).pass).toBe(true);
    expect(guard.check(action('http://localhost:3000/health')).pass).toBe(true);
  });

  it('blocks non-allowlisted domains', () => {
    const result = guard.check(action('https://evil.com/steal'));
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('evil.com');
    }
  });

  it('blocks invalid URLs', () => {
    const result = guard.check(action('not-a-url'));
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('Invalid URL');
    }
  });

  it('blocks specific ports when configured', () => {
    const portGuard = new EgressGuard({
      allowedDomains: ['localhost'],
      blockedPorts: [22, 3389],
    });

    expect(portGuard.check(action('http://localhost:3000')).pass).toBe(true);
    expect(portGuard.check(action('http://localhost:22')).pass).toBe(false);
  });

  it('allowlist is immutable — no runtime modification', () => {
    const guard2 = new EgressGuard({ allowedDomains: ['safe.com'] });
    expect(guard2.check(action('https://safe.com')).pass).toBe(true);
    expect(guard2.check(action('https://evil.com')).pass).toBe(false);

    // Verify there is no allow() method to mutate the allowlist at runtime
    expect('allow' in guard2).toBe(false);
  });
});
