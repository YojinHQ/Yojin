import { existsSync } from 'node:fs';
import { appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentMessage } from '../../src/core/types.js';
import { JsonlSessionStore } from '../../src/sessions/jsonl-store.js';

function sessionData(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'slack',
    userId: 'user1',
    providerId: 'anthropic',
    model: 'claude-opus-4-6',
    ...overrides,
  };
}

describe('JsonlSessionStore', () => {
  let store: JsonlSessionStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `yojin-test-sessions-${Date.now()}`);
    store = new JsonlSessionStore(testDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('auto-creates the sessions directory', async () => {
    await store.create(sessionData());
    expect(existsSync(testDir)).toBe(true);
  });

  it('creates a session and returns metadata', async () => {
    const meta = await store.create(sessionData());
    expect(meta.id).toBeDefined();
    expect(meta.channelId).toBe('slack');
    expect(meta.userId).toBe('user1');
    expect(meta.createdAt).toBeTypeOf('number');
  });

  it('gets session metadata by id', async () => {
    const created = await store.create(sessionData());
    const fetched = await store.get(created.id);
    expect(fetched).toEqual(created);
  });

  it('returns undefined for unknown session id', async () => {
    const result = await store.get('00000000-0000-0000-0000-000000000000');
    expect(result).toBeUndefined();
  });

  it('rejects invalid session id format', async () => {
    expect(await store.get('nonexistent')).toBeUndefined();
    expect(await store.get('../config/secrets')).toBeUndefined();
    await expect(store.append('../traversal', { role: 'user', content: '' })).rejects.toThrow('Invalid session id');
    await expect(store.delete('../traversal')).rejects.toThrow('Invalid session id');
  });

  it('finds session by thread', async () => {
    await store.create(sessionData({ threadId: 'thread-1' }));
    const found = await store.getByThread('slack', 'thread-1');
    expect(found).toBeDefined();
    expect(found!.threadId).toBe('thread-1');
  });

  it('returns undefined for unknown thread', async () => {
    const result = await store.getByThread('slack', 'nonexistent');
    expect(result).toBeUndefined();
  });

  it('appends messages and retrieves history', async () => {
    const meta = await store.create(sessionData());

    const msg1: AgentMessage = { role: 'user', content: 'Hello' };
    const msg2: AgentMessage = { role: 'assistant', content: 'Hi there' };

    const entry1 = await store.append(meta.id, msg1);
    const entry2 = await store.append(meta.id, msg2);

    expect(entry1.sequence).toBe(0);
    expect(entry2.sequence).toBe(1);
    expect(entry1.sessionId).toBe(meta.id);

    const history = await store.getHistory(meta.id);
    expect(history).toHaveLength(2);
    expect(history[0].message.content).toBe('Hello');
    expect(history[1].message.content).toBe('Hi there');
  });

  it('appends messages with ContentBlock arrays', async () => {
    const meta = await store.create(sessionData({ channelId: 'web' }));

    const msg: AgentMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check that.' },
        { type: 'tool_use', id: 'call_1', name: 'get_time', input: {} },
      ],
    };

    await store.append(meta.id, msg);
    const history = await store.getHistory(meta.id);
    expect(history).toHaveLength(1);
    expect(Array.isArray(history[0].message.content)).toBe(true);
  });

  it('returns empty history for session with no messages', async () => {
    const meta = await store.create(sessionData());
    const history = await store.getHistory(meta.id);
    expect(history).toEqual([]);
  });

  it('throws when appending to nonexistent session', async () => {
    const msg: AgentMessage = { role: 'user', content: 'Hello' };
    await expect(store.append('00000000-0000-0000-0000-000000000000', msg)).rejects.toThrow('Session not found');
  });

  it('lists session ids', async () => {
    const s1 = await store.create(sessionData());
    const s2 = await store.create(sessionData({ channelId: 'web', userId: 'user2' }));
    const ids = await store.list();
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);
  });

  it('lists returns empty array when directory does not exist', async () => {
    const emptyStore = new JsonlSessionStore(join(tmpdir(), `nonexistent-${Date.now()}`));
    const ids = await emptyStore.list();
    expect(ids).toEqual([]);
  });

  it('deletes a session', async () => {
    const meta = await store.create(sessionData());
    await store.delete(meta.id);
    expect(await store.get(meta.id)).toBeUndefined();
    expect(await store.list()).not.toContain(meta.id);
  });

  it('skips malformed JSONL lines gracefully', async () => {
    const meta = await store.create(sessionData());

    const msg: AgentMessage = { role: 'user', content: 'Good message' };
    await store.append(meta.id, msg);

    const filePath = join(testDir, `${meta.id}.jsonl`);
    await appendFile(filePath, '{bad json\n');

    const history = await store.getHistory(meta.id);
    expect(history).toHaveLength(1);
    expect(history[0].message.content).toBe('Good message');
  });

  it('persists across store instances', async () => {
    const meta = await store.create(sessionData());

    const msg: AgentMessage = { role: 'user', content: 'Persisted' };
    await store.append(meta.id, msg);

    const store2 = new JsonlSessionStore(testDir);
    const history = await store2.getHistory(meta.id);
    expect(history).toHaveLength(1);
    expect(history[0].message.content).toBe('Persisted');

    const fetched = await store2.get(meta.id);
    expect(fetched).toEqual(meta);
  });
});
