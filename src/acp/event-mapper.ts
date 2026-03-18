import type { AgentLoopEvent } from '../core/types.js';

export interface AcpSessionUpdate {
  sessionId: string;
  update: Record<string, unknown>;
}

export function mapEventToUpdates(event: AgentLoopEvent, sessionId: string): AcpSessionUpdate[] {
  switch (event.type) {
    case 'thought':
    case 'text_delta':
      return [
        {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: event.text },
          },
        },
      ];

    case 'action':
      return event.toolCalls.map((tc) => ({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: tc.id,
          title: tc.name,
          kind: 'other',
          status: 'in_progress',
          rawInput: JSON.stringify(tc.input),
        },
      }));

    case 'observation':
      return event.results.map((r) => ({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: r.toolCallId,
          status: r.result.isError ? 'failed' : 'completed',
          content: [
            {
              type: 'content',
              content: { type: 'text', text: r.result.content },
            },
          ],
        },
      }));

    case 'tool_result_truncated':
      return [
        {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: `[Tool "${event.toolName}" output truncated: ${event.originalChars} -> ${event.truncatedChars} chars]`,
            },
          },
        },
      ];

    case 'done':
      // Text was already streamed via text_delta events — don't re-emit.
      return [];

    case 'max_iterations':
      return [
        {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: `Reached maximum iterations (${event.iterations}). Please try a simpler request.`,
            },
          },
        },
      ];

    case 'compaction':
    case 'error':
      return [];
  }
}
