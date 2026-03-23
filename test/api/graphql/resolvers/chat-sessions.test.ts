/**
 * Tests for session-related GraphQL resolvers in chat.ts.
 *
 * Uses InMemorySessionStore to avoid file I/O.
 * Tests cover: sessionsQuery, sessionQuery, activeSessionQuery,
 * createSessionMutation, deleteSessionMutation, and title derivation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  activeSessionQuery,
  createSessionMutation,
  deleteSessionMutation,
  sessionQuery,
  sessionsQuery,
  setSessionStore,
} from '../../../../src/api/graphql/resolvers/chat.js';
import type { AgentMessage } from '../../../../src/core/types.js';
import { InMemorySessionStore } from '../../../../src/sessions/memory-store.js';

function webSession(threadId: string) {
  return {
    channelId: 'web',
    threadId,
    userId: 'web-user',
    providerId: 'agent-runtime',
    model: 'claude-sonnet-4-6',
  };
}

function slackSession(threadId: string) {
  return {
    channelId: 'slack',
    threadId,
    userId: 'slack-user',
    providerId: 'anthropic',
    model: 'claude-opus-4-6',
  };
}

describe('Chat session resolvers', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
    setSessionStore(store);
  });

  afterEach(() => {
    // Reset by injecting a fresh store (clears module-level state)
    setSessionStore(new InMemorySessionStore());
  });

  // -----------------------------------------------------------------------
  // sessionsQuery
  // -----------------------------------------------------------------------

  describe('sessionsQuery', () => {
    it('returns empty array when no sessions exist', async () => {
      const result = await sessionsQuery();
      expect(result).toEqual([]);
    });

    it('returns only web channel sessions', async () => {
      await store.create(webSession('web-thread-1'));
      await store.create(slackSession('slack-thread-1'));

      const result = await sessionsQuery();
      expect(result).toHaveLength(1);
      expect(result[0].threadId).toBe('web-thread-1');
    });

    it('includes correct metadata fields', async () => {
      const meta = await store.create(webSession('web-thread-1'));
      await store.append(meta.id, { role: 'user', content: 'Hello Yojin' });
      await store.append(meta.id, { role: 'assistant', content: 'Hi there!' });

      const result = await sessionsQuery();
      expect(result).toHaveLength(1);

      const session = result[0];
      expect(session.id).toBe(meta.id);
      expect(session.threadId).toBe('web-thread-1');
      expect(session.title).toBe('Hello Yojin');
      expect(session.createdAt).toBeTruthy();
      expect(session.lastMessageAt).toBeTruthy();
      expect(session.messageCount).toBe(2);
    });

    it('sorts sessions by most recent first', async () => {
      const older = await store.create(webSession('web-thread-old'));
      await store.append(older.id, { role: 'user', content: 'Old message' });

      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));

      const newer = await store.create(webSession('web-thread-new'));
      await store.append(newer.id, { role: 'user', content: 'New message' });

      const result = await sessionsQuery();
      expect(result).toHaveLength(2);
      expect(result[0].threadId).toBe('web-thread-new');
      expect(result[1].threadId).toBe('web-thread-old');
    });

    it('derives title from first user message', async () => {
      const meta = await store.create(webSession('web-thread-1'));
      // First message is assistant (should be skipped for title)
      await store.append(meta.id, { role: 'assistant', content: 'Welcome!' });
      await store.append(meta.id, { role: 'user', content: 'What is my portfolio worth?' });

      const result = await sessionsQuery();
      expect(result[0].title).toBe('What is my portfolio worth?');
    });

    it('truncates long titles to ~50 chars', async () => {
      const meta = await store.create(webSession('web-thread-1'));
      const longMsg = 'A'.repeat(60);
      await store.append(meta.id, { role: 'user', content: longMsg });

      const result = await sessionsQuery();
      expect(result[0].title.length).toBeLessThanOrEqual(50);
      expect(result[0].title).toMatch(/…$/);
    });

    it('defaults title to "New conversation" when no user messages', async () => {
      const meta = await store.create(webSession('web-thread-1'));
      await store.append(meta.id, { role: 'assistant', content: 'Welcome!' });

      const result = await sessionsQuery();
      expect(result[0].title).toBe('New conversation');
    });

    it('defaults title to "New conversation" for empty session', async () => {
      await store.create(webSession('web-thread-1'));

      const result = await sessionsQuery();
      expect(result[0].title).toBe('New conversation');
    });

    it('handles ContentBlock[] messages for title derivation', async () => {
      const meta = await store.create(webSession('web-thread-1'));
      const richMessage: AgentMessage = {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
          { type: 'text', text: 'Analyze this screenshot' },
        ],
      };
      await store.append(meta.id, richMessage);

      const result = await sessionsQuery();
      expect(result[0].title).toBe('Analyze this screenshot');
    });

    it('returns "New conversation" when content blocks have no text', async () => {
      const meta = await store.create(webSession('web-thread-1'));
      const imageOnly: AgentMessage = {
        role: 'user',
        content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } }],
      };
      await store.append(meta.id, imageOnly);

      const result = await sessionsQuery();
      expect(result[0].title).toBe('New conversation');
    });
  });

  // -----------------------------------------------------------------------
  // sessionQuery
  // -----------------------------------------------------------------------

  describe('sessionQuery', () => {
    it('returns null for unknown session id', async () => {
      const result = await sessionQuery(null, { id: 'nonexistent-id' });
      expect(result).toBeNull();
    });

    it('returns full session with messages', async () => {
      const meta = await store.create(webSession('web-thread-1'));
      await store.append(meta.id, { role: 'user', content: 'Hello' });
      await store.append(meta.id, { role: 'assistant', content: 'Hi there!' });

      const result = await sessionQuery(null, { id: meta.id });
      expect(result).not.toBeNull();
      expect(result!.id).toBe(meta.id);
      expect(result!.threadId).toBe('web-thread-1');
      expect(result!.title).toBe('Hello');
      expect(result!.messages).toHaveLength(2);
    });

    it('maps message roles to GraphQL enum values', async () => {
      const meta = await store.create(webSession('web-thread-1'));
      await store.append(meta.id, { role: 'user', content: 'Q' });
      await store.append(meta.id, { role: 'assistant', content: 'A' });

      const result = await sessionQuery(null, { id: meta.id });
      expect(result!.messages[0].role).toBe('USER');
      expect(result!.messages[1].role).toBe('ASSISTANT');
    });

    it('generates stable message ids from session + sequence', async () => {
      const meta = await store.create(webSession('web-thread-1'));
      await store.append(meta.id, { role: 'user', content: 'msg' });

      const result = await sessionQuery(null, { id: meta.id });
      expect(result!.messages[0].id).toBe(`${meta.id}-0`);
    });

    it('flattens ContentBlock[] to text in messages', async () => {
      const meta = await store.create(webSession('web-thread-1'));
      const richMessage: AgentMessage = {
        role: 'user',
        content: [
          { type: 'text', text: 'Line one' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
          { type: 'text', text: 'Line two' },
        ],
      };
      await store.append(meta.id, richMessage);

      const result = await sessionQuery(null, { id: meta.id });
      expect(result!.messages[0].content).toBe('Line one\nLine two');
    });

    it('returns empty messages array for session with no messages', async () => {
      const meta = await store.create(webSession('web-thread-1'));

      const result = await sessionQuery(null, { id: meta.id });
      expect(result!.messages).toEqual([]);
      expect(result!.lastMessageAt).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // activeSessionQuery
  // -----------------------------------------------------------------------

  describe('activeSessionQuery', () => {
    it('returns null when no active session', async () => {
      const result = await activeSessionQuery();
      expect(result).toBeNull();
    });

    it('returns the active session after createSession', async () => {
      const created = await createSessionMutation();

      const active = await activeSessionQuery();
      expect(active).not.toBeNull();
      expect(active!.id).toBe(created.id);
      expect(active!.threadId).toBe(created.threadId);
    });

    it('tracks the most recently created session', async () => {
      await createSessionMutation();
      const second = await createSessionMutation();

      const active = await activeSessionQuery();
      expect(active!.id).toBe(second.id);
    });
  });

  // -----------------------------------------------------------------------
  // createSessionMutation
  // -----------------------------------------------------------------------

  describe('createSessionMutation', () => {
    it('creates a session and returns summary', async () => {
      const result = await createSessionMutation();

      expect(result.id).toBeTruthy();
      expect(result.threadId).toMatch(/^web-/);
      expect(result.title).toBe('New conversation');
      expect(result.messageCount).toBe(0);
      expect(result.lastMessageAt).toBeNull();
      expect(result.createdAt).toBeTruthy();
    });

    it('creates a session that appears in sessionsQuery', async () => {
      await createSessionMutation();

      const sessions = await sessionsQuery();
      expect(sessions).toHaveLength(1);
    });

    it('creates a session persisted in the store', async () => {
      const result = await createSessionMutation();

      const meta = await store.get(result.id);
      expect(meta).toBeDefined();
      expect(meta!.channelId).toBe('web');
      expect(meta!.userId).toBe('web-user');
    });

    it('throws when session store not initialized', async () => {
      // Reset to simulate uninitialized state
      setSessionStore(undefined as unknown as InMemorySessionStore);

      await expect(createSessionMutation()).rejects.toThrow('Session store not initialized');
    });
  });

  // -----------------------------------------------------------------------
  // deleteSessionMutation
  // -----------------------------------------------------------------------

  describe('deleteSessionMutation', () => {
    it('deletes a session and returns true', async () => {
      const created = await createSessionMutation();

      const result = await deleteSessionMutation(null, { id: created.id });
      expect(result).toBe(true);
    });

    it('removes session from sessionsQuery results', async () => {
      const created = await createSessionMutation();
      await deleteSessionMutation(null, { id: created.id });

      const sessions = await sessionsQuery();
      expect(sessions).toHaveLength(0);
    });

    it('removes session from store', async () => {
      const created = await createSessionMutation();
      await deleteSessionMutation(null, { id: created.id });

      const meta = await store.get(created.id);
      expect(meta).toBeUndefined();
    });

    it('throws when session store not initialized', async () => {
      setSessionStore(undefined as unknown as InMemorySessionStore);

      await expect(deleteSessionMutation(null, { id: 'any' })).rejects.toThrow('Session store not initialized');
    });
  });
});
