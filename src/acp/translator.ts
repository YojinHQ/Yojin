import type { AgentSideConnection } from '@agentclientprotocol/sdk';

import { mapEventToUpdates } from './event-mapper.js';
import type { RuntimeBridge } from './runtime-bridge.js';
import type { AcpSessionStore } from './session-store.js';
import { createSubsystemLogger } from '../logging/logger.js';

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
        version: '0.1.0',
      },
      authMethods: [],
    };
  }

  async authenticate(_params: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {};
  }

  async newSession(params: { cwd: string }): Promise<{ sessionId: string; modes?: unknown }> {
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
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text as string)
      .join('\n');

    if (!message) {
      throw new Error('Empty prompt — no text content');
    }

    let stopReason = 'end_turn';

    try {
      const events = this.bridge.sendPrompt({
        message,
        channelId: 'acp',
        userId: 'local',
        threadId: session.threadId,
      });

      for await (const event of events) {
        const updates = mapEventToUpdates(event, params.sessionId);
        for (const update of updates) {
          await this.connection.sessionUpdate(update);
        }

        if (event.type === 'max_iterations') {
          stopReason = 'max_iterations';
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

  async setSessionMode(_params: { sessionId: string; mode: string }): Promise<{ mode: string }> {
    return { mode: 'default' };
  }
}
