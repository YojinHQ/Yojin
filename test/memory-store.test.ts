import { describe, expect, it } from 'vitest';

import type { AgentMessage } from '../src/core/types.js';
import { InMemorySessionStore } from '../src/sessions/memory-store.js';

function sessionData(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'slack',
    threadId: 'thread-1',
    userId: 'user-1',
    providerId: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    ...overrides,
  };
}

describe('InMemorySessionStore', () => {
  it('creates a session with generated id and timestamps', async () => {
    const store = new InMemorySessionStore();
    const session = await store.create(sessionData());

    expect(session.id).toBeDefined();
    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(0);
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.channelId).toBe('slack');
    expect(session.userId).toBe('user-1');
  });

  it('retrieves session metadata by id', async () => {
    const store = new InMemorySessionStore();
    const created = await store.create(sessionData());
    const fetched = await store.get(created.id);
    expect(fetched).toEqual(created);
  });

  it('returns undefined for unknown id', async () => {
    const store = new InMemorySessionStore();
    expect(await store.get('nonexistent')).toBeUndefined();
  });

  it('finds a session by channel and thread', async () => {
    const store = new InMemorySessionStore();
    await store.create(sessionData({ channelId: 'slack', threadId: 't1' }));
    await store.create(sessionData({ channelId: 'slack', threadId: 't2' }));

    const found = await store.getByThread('slack', 't2');
    expect(found).toBeDefined();
    expect(found!.threadId).toBe('t2');
  });

  it('returns undefined when thread not found', async () => {
    const store = new InMemorySessionStore();
    await store.create(sessionData({ channelId: 'slack', threadId: 't1' }));
    expect(await store.getByThread('slack', 't99')).toBeUndefined();
  });

  it('appends messages and retrieves history', async () => {
    const store = new InMemorySessionStore();
    const session = await store.create(sessionData());

    const msg1: AgentMessage = { role: 'user', content: 'Hello' };
    const msg2: AgentMessage = { role: 'assistant', content: 'Hi' };

    const entry1 = await store.append(session.id, msg1);
    const entry2 = await store.append(session.id, msg2);

    expect(entry1.sequence).toBe(0);
    expect(entry2.sequence).toBe(1);

    const history = await store.getHistory(session.id);
    expect(history).toHaveLength(2);
    expect(history[0].message.content).toBe('Hello');
    expect(history[1].message.content).toBe('Hi');
  });

  it('throws when appending to nonexistent session', async () => {
    const store = new InMemorySessionStore();
    const msg: AgentMessage = { role: 'user', content: 'Hello' };
    await expect(store.append('fake', msg)).rejects.toThrow('Session not found');
  });

  it('returns empty history for session with no messages', async () => {
    const store = new InMemorySessionStore();
    const session = await store.create(sessionData());
    const history = await store.getHistory(session.id);
    expect(history).toEqual([]);
  });

  it('lists session ids', async () => {
    const store = new InMemorySessionStore();
    const s1 = await store.create(sessionData({ userId: 'u1' }));
    const s2 = await store.create(sessionData({ userId: 'u2' }));
    const ids = await store.list();
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);
  });

  it('deletes a session and its history', async () => {
    const store = new InMemorySessionStore();
    const session = await store.create(sessionData());
    const msg: AgentMessage = { role: 'user', content: 'Hello' };
    await store.append(session.id, msg);

    await store.delete(session.id);
    expect(await store.get(session.id)).toBeUndefined();
    expect(await store.getHistory(session.id)).toEqual([]);
  });

  it('delete is idempotent for unknown ids', async () => {
    const store = new InMemorySessionStore();
    await expect(store.delete('nonexistent')).resolves.toBeUndefined();
  });

  it('creates multiple independent sessions', async () => {
    const store = new InMemorySessionStore();
    const s1 = await store.create(sessionData({ userId: 'u1' }));
    const s2 = await store.create(sessionData({ userId: 'u2' }));
    expect(s1.id).not.toBe(s2.id);
    expect((await store.get(s1.id))!.userId).toBe('u1');
    expect((await store.get(s2.id))!.userId).toBe('u2');
  });
});
