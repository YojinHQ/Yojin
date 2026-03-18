import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ToolPolicyGuard } from '../../../src/guards/security/tool-policy.js';
import type { ProposedAction } from '../../../src/guards/types.js';

function action(toolName: string, input?: unknown): ProposedAction {
  return { type: 'tool_call', toolName, input };
}

describe('ToolPolicyGuard', () => {
  it('allows all tools by default', () => {
    const guard = new ToolPolicyGuard();
    expect(guard.check(action('anything')).pass).toBe(true);
  });

  it('denies all tools when default is deny', () => {
    const guard = new ToolPolicyGuard({ defaultAction: 'deny' });

    const result = guard.check(action('unknown-tool'));
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('not in allowlist');
    }
  });

  it('allows specifically allowed tools in deny-default mode', () => {
    const guard = new ToolPolicyGuard({
      defaultAction: 'deny',
      policies: [{ tool: 'safe-tool', action: 'allow' }],
    });

    expect(guard.check(action('safe-tool')).pass).toBe(true);
    expect(guard.check(action('other-tool')).pass).toBe(false);
  });

  it('denies specifically denied tools in allow-default mode', () => {
    const guard = new ToolPolicyGuard({
      defaultAction: 'allow',
      policies: [{ tool: 'dangerous-tool', action: 'deny', reason: 'too dangerous' }],
    });

    expect(guard.check(action('safe-tool')).pass).toBe(true);

    const result = guard.check(action('dangerous-tool'));
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('too dangerous');
    }
  });

  it('validates input against schema when provided', () => {
    const guard = new ToolPolicyGuard({
      policies: [
        {
          tool: 'search',
          action: 'allow',
          inputSchema: z.object({ query: z.string(), maxResults: z.number().max(100) }),
        },
      ],
    });

    // Valid input
    expect(guard.check(action('search', { query: 'test', maxResults: 10 })).pass).toBe(true);

    // Invalid input
    const result = guard.check(action('search', { query: 'test', maxResults: 999 }));
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('input validation failed');
    }
  });

  it('passes actions without toolName', () => {
    const guard = new ToolPolicyGuard({ defaultAction: 'deny' });
    expect(guard.check({ type: 'tool_call' }).pass).toBe(true);
  });

  it('supports runtime policy addition', () => {
    const guard = new ToolPolicyGuard({ defaultAction: 'deny' });
    expect(guard.check(action('new-tool')).pass).toBe(false);

    guard.addPolicy({ tool: 'new-tool', action: 'allow' });
    expect(guard.check(action('new-tool')).pass).toBe(true);
  });
});
