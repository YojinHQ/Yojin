import { createRequire } from 'node:module';

import type { AgentSideConnection } from '@agentclientprotocol/sdk';

import { mapEventToUpdates } from './event-mapper.js';
import type { RuntimeBridge } from './runtime-bridge.js';
import type { AcpSessionStore } from './session-store.js';
import { createSubsystemLogger } from '../logging/logger.js';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../../package.json') as { version: string };

const PROTOCOL_VERSION = 1;
const logger = createSubsystemLogger('acp');

export class YojinAcpAgent {
  constructor(
    private readonly bridge: RuntimeBridge,
    private readonly sessionStore: AcpSessionStore,
    private readonly connection: AgentSideConnection,
  ) {}

  async initialize(_params: { protocolVersion: number; clientCapabilities: Record<string, unknown> }): Promise<{
    protocolVersion: number;
    agentCapabilities: Record<string, unknown>;
    agentInfo: { name: string; title: string; version: string };
    authMethods: unknown[];
  }> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: false,
        },
      },
      agentInfo: {
        name: 'yojin',
        title: 'Yojin — Personal AI Finance Agent',
        version: PKG_VERSION,
      },
      authMethods: [],
    };
  }

  async authenticate(_params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {};
  }

  async newSession(params: { cwd: string }): Promise<{ sessionId: string; modes?: unknown }> {
    // cwd is persisted for future use (e.g., scoping filesystem tools to the client's project directory)
    const session = this.sessionStore.create(params.cwd);
    logger.info('ACP session created', { sessionId: session.sessionId, cwd: params.cwd });
    return { sessionId: session.sessionId };
  }

  async loadSession(params: { sessionId: string }): Promise<{ sessionId: string }> {
    const session = this.sessionStore.get(params.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${params.sessionId}`);
    }
    logger.info('ACP session loaded', { sessionId: params.sessionId });
    return { sessionId: params.sessionId };
  }

  async prompt(params: {
    sessionId: string;
    prompt: Array<{ type: string; text?: string }>;
  }): Promise<{ stopReason: string }> {
    const session = this.sessionStore.get(params.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${params.sessionId}`);
    }

    const message = params.prompt
      .filter((p): p is { type: string; text: string } => p.type === 'text' && !!p.text)
      .map((p) => p.text)
      .join('\n');

    if (!message) {
      throw new Error('Empty prompt — no text content');
    }

    let stopReason = 'end_turn';

    try {
      const events = this.bridge.sendPrompt({
        message,
        channelId: 'acp',
        userId: session.userId,
        threadId: session.threadId,
      });

      for await (const event of events) {
        const updates = mapEventToUpdates(event, params.sessionId);
        for (const update of updates) {
          await this.connection.sessionUpdate(update);
        }

        if (event.type === 'max_iterations') {
          stopReason = 'max_iterations';
        } else if (event.type === 'error') {
          stopReason = 'error';
        }
      }
    } catch (err) {
      logger.error('Prompt failed', { sessionId: params.sessionId, error: String(err) });
      throw err;
    }

    return { stopReason };
  }

  async cancel(params: { sessionId: string }): Promise<void> {
    const session = this.sessionStore.get(params.sessionId);
    if (session) {
      await this.bridge.abort(session.threadId);
    }
  }

  async setSessionMode(params: { sessionId: string; mode: string }): Promise<{ mode: string }> {
    if (params.mode !== 'default') {
      throw new Error(`Unsupported session mode: ${params.mode}`);
    }
    return { mode: 'default' };
  }
}
