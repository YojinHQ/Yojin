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

  it('prompt throws for empty text content', async () => {
    const bridge = mockBridge();
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    const session = await agent.newSession({ cwd: '/tmp' });
    await expect(
      agent.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'image' }],
      }),
    ).rejects.toThrow('Empty prompt');
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

  // --- New tests for PR review feedback ---

  it('returns stopReason error when runtime throws instead of rethrowing', async () => {
    const bridge: RuntimeBridge = {
      sendPrompt: vi.fn(() => ({
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() {
          throw new Error('LLM provider unavailable');
        },
      })),
      abort: vi.fn(async () => {}),
    };
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    const session = await agent.newSession({ cwd: '/tmp' });
    const result = await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'hello' }],
    });

    // Should NOT throw — returns graceful stopReason instead
    expect(result.stopReason).toBe('error');
    // Should attempt to send error message to client
    expect(conn.sessionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.sessionId,
        update: expect.objectContaining({
          sessionUpdate: 'agent_message_chunk',
          content: expect.objectContaining({ text: expect.stringContaining('LLM provider unavailable') }),
        }),
      }),
    );
  });

  it('aborts agent loop when sessionUpdate throws (client disconnect)', async () => {
    const events: AgentLoopEvent[] = [
      { type: 'text_delta', text: 'hello' },
      { type: 'text_delta', text: ' world' },
      { type: 'done', text: 'hello world', iterations: 1 },
    ];
    const bridge = mockBridge(events);
    const conn = mockConnection();
    // Simulate client disconnect on first sessionUpdate
    conn.sessionUpdate.mockRejectedValueOnce(new Error('client disconnected'));
    const agent = createAgent(bridge, store, conn);

    const session = await agent.newSession({ cwd: '/tmp' });
    const result = await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'hello' }],
    });

    expect(result.stopReason).toBe('error');
    expect(bridge.abort).toHaveBeenCalledWith(session.sessionId ? store.get(session.sessionId)?.threadId : '');
  });

  it('rejects concurrent prompts for the same session', async () => {
    // Create a bridge that never resolves — simulates a long-running prompt
    let resolvePrompt: () => void;
    const bridge: RuntimeBridge = {
      sendPrompt: vi.fn(() => ({
        // eslint-disable-next-line require-yield
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((r) => {
            resolvePrompt = r;
          });
        },
      })),
      abort: vi.fn(async () => {}),
    };
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    const session = await agent.newSession({ cwd: '/tmp' });
    const promptParams = {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'hello' }],
    };

    // Start first prompt (will hang)
    const firstPrompt = agent.prompt(promptParams);

    // Second prompt should be rejected immediately
    await expect(agent.prompt(promptParams)).rejects.toThrow('already has an in-flight prompt');

    // Clean up: resolve the first prompt
    resolvePrompt!();
    await firstPrompt;
  });

  it('setSessionMode throws for unsupported modes', async () => {
    const bridge = mockBridge();
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    const session = await agent.newSession({ cwd: '/tmp' });
    await expect(agent.setSessionMode({ sessionId: session.sessionId, mode: 'turbo' })).rejects.toThrow(
      'Unsupported session mode',
    );
  });

  it('setSessionMode accepts default mode', async () => {
    const bridge = mockBridge();
    const conn = mockConnection();
    const agent = createAgent(bridge, store, conn);

    const session = await agent.newSession({ cwd: '/tmp' });
    const result = await agent.setSessionMode({ sessionId: session.sessionId, mode: 'default' });
    expect(result.mode).toBe('default');
  });
});
