import { Readable, Writable } from 'node:stream';

import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';

import type { RuntimeBridge } from './runtime-bridge.js';
import type { AcpSessionStore } from './session-store.js';
import { YojinAcpAgent } from './translator.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('acp-server');

export interface AcpServerOptions {
  bridge: RuntimeBridge;
  sessionStore: AcpSessionStore;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
}

export interface AcpServerHandle {
  shutdown: () => Promise<void>;
  connection: AgentSideConnection;
}

export function startAcpServer(options: AcpServerOptions): AcpServerHandle {
  const { bridge, sessionStore } = options;
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;

  const output = Writable.toWeb(stdout as NodeJS.WritableStream) as WritableStream<Uint8Array>;
  const input = Readable.toWeb(stdin as NodeJS.ReadableStream) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(output, input);

  const connection = new AgentSideConnection((conn: AgentSideConnection) => {
    const agent = new YojinAcpAgent(bridge, sessionStore, conn);
    logger.info('ACP connection established');
    return agent;
  }, stream);

  logger.info('ACP server started on stdio');

  const shutdown = async () => {
    logger.info('ACP server shutting down');
    await Promise.all(sessionStore.list().map((session) => bridge.abort(session.threadId)));
  };

  return { shutdown, connection };
}
