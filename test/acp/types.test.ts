import { describe, expect, it } from 'vitest';

import { AcpSessionSchema } from '../../src/acp/types.js';

describe('AcpSession schema', () => {
  it('validates a complete session', () => {
    const result = AcpSessionSchema.safeParse({
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      threadId: 'acp:550e8400-e29b-41d4-a716-446655440000',
      cwd: '/Users/dima/projects/Yojin',
      createdAt: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing sessionId', () => {
    const result = AcpSessionSchema.safeParse({
      threadId: 'acp:123',
      cwd: '/tmp',
      createdAt: Date.now(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID', () => {
    const result = AcpSessionSchema.safeParse({
      sessionId: 'not-a-uuid',
      threadId: 'acp:not-a-uuid',
      cwd: '/tmp',
      createdAt: Date.now(),
    });
    expect(result.success).toBe(false);
  });
});
