import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AcpSessionStore } from '../../src/acp/session-store.js';

describe('AcpSessionStore', () => {
  let tempDir: string;
  let store: AcpSessionStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-acp-'));
    store = new AcpSessionStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a session and retrieves it', () => {
    const session = store.create('/Users/dima/projects/Yojin');
    expect(session.sessionId).toBeDefined();
    expect(session.threadId).toBe(`acp:${session.sessionId}`);
    expect(session.cwd).toBe('/Users/dima/projects/Yojin');

    const retrieved = store.get(session.sessionId);
    expect(retrieved).toEqual(session);
  });

  it('returns undefined for unknown session', () => {
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('persists sessions to JSON and loads on new instance', () => {
    const session = store.create('/tmp');

    const store2 = new AcpSessionStore(tempDir);
    const loaded = store2.get(session.sessionId);
    expect(loaded).toEqual(session);
  });

  it('lists all sessions', () => {
    store.create('/a');
    store.create('/b');
    expect(store.list()).toHaveLength(2);
  });

  it('deletes a session', () => {
    const session = store.create('/tmp');
    store.delete(session.sessionId);
    expect(store.get(session.sessionId)).toBeUndefined();
  });
});
