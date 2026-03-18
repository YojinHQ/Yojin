import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeBridge } from '../../src/acp/runtime-bridge.js';
import { AcpSessionStore } from '../../src/acp/session-store.js';
import { YojinAcpAgent } from '../../src/acp/translator.js';
import type { AgentLoopEvent } from '../../src/core/types.js';

type MockConnection = { sessionUpdate: ReturnType<typeof vi.fn> };

function mockBridge(events: AgentLoopEvent[] = []): RuntimeBridge {
  return {
    sendPrompt: vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        for (const e of events) yield e;
      },
    })),
    abort: vi.fn(async () => {}),
  };
}

function mockConnection(): MockConnection {
  return {
    sessionUpdate: vi.fn(async () => {}),
  };
}

function createAgent(bridge: RuntimeBridge, store: AcpSessionStore, conn: MockConnection): YojinAcpAgent {
  return new YojinAcpAgent(bridge, store, conn as unknown as ConstructorParameters<typeof YojinAcpAgent>[2]);
}

describe('YojinAcpAgent', () => {
  let tempDir: string;
  let store: AcpSessionStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-acp-translator-'));
    store = new AcpSessionStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('initialize returns protocol version and capabilities', async () => {
    const bridge = mockBridge();
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    const result = await agent.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
    });

    expect(result.protocolVersion).toBe(1);
    expect(result.agentInfo.name).toBe('yojin');
    expect(result.agentCapabilities.loadSession).toBe(true);
  });

  it('newSession creates a session and returns sessionId', async () => {
    const bridge = mockBridge();
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    const result = await agent.newSession({ cwd: '/tmp/project' });
    expect(result.sessionId).toBeDefined();
    expect(store.get(result.sessionId)).toBeDefined();
  });

  it('prompt streams events and resolves with end_turn', async () => {
    const events: AgentLoopEvent[] = [
      { type: 'thought', text: 'thinking...' },
      { type: 'done', text: 'final answer', iterations: 1 },
    ];
    const bridge = mockBridge(events);
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    const session = await agent.newSession({ cwd: '/tmp' });
    const result = await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'hello' }],
    });

    expect(result.stopReason).toBe('end_turn');
    expect(conn.sessionUpdate).toHaveBeenCalled();
  });

  it('prompt throws for unknown session', async () => {
    const bridge = mockBridge();
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    await expect(
      agent.prompt({
        sessionId: 'nonexistent',
        prompt: [{ type: 'text', text: 'hello' }],
      }),
    ).rejects.toThrow('Unknown session');
  });

  it('cancel aborts the runtime bridge using threadId', async () => {
    const bridge = mockBridge();
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    const session = await agent.newSession({ cwd: '/tmp' });
    await agent.cancel({ sessionId: session.sessionId });

    const storedSession = store.get(session.sessionId);
    expect(storedSession).toBeDefined();
    expect(bridge.abort).toHaveBeenCalledWith(storedSession?.threadId);
  });

  it('loadSession returns sessionId for known session', async () => {
    const bridge = mockBridge();
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    const session = await agent.newSession({ cwd: '/tmp' });
    const loaded = await agent.loadSession({ sessionId: session.sessionId });
    expect(loaded.sessionId).toBe(session.sessionId);
  });

  it('loadSession throws for unknown session', async () => {
    const bridge = mockBridge();
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    await expect(agent.loadSession({ sessionId: 'nonexistent' })).rejects.toThrow('Unknown session');
  });

  it('authenticate returns empty (no-op)', async () => {
    const bridge = mockBridge();
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    const result = await agent.authenticate({});
    expect(result).toEqual({});
  });
});
