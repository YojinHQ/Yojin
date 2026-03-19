import type { AgentLoopEvent } from '../core/types.js';

export interface AcpSessionUpdate {
  sessionId: string;
  update: Record<string, unknown>;
}

/**
 * Creates a stateful event mapper for a single prompt lifecycle.
 *
 * Tracks whether text_delta events have been emitted so that the
 * subsequent `thought` event (which contains the same assembled text)
 * is suppressed — preventing duplicate content delivery to the client.
 */
export function createEventMapper(sessionId: string): (event: AgentLoopEvent) => AcpSessionUpdate[] {
  let hasStreamedText = false;

  return (event: AgentLoopEvent): AcpSessionUpdate[] => {
    switch (event.type) {
      case 'text_delta':
        hasStreamedText = true;
        return [
          {
            sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: event.text },
            },
          },
        ];

      case 'thought':
        // When streaming, text_delta already delivered this content — skip to avoid duplicates.
        if (hasStreamedText) return [];
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
        // Text was already streamed via text_delta or thought events — don't re-emit.
        // Reset for next iteration (tool call → new LLM response within the same prompt).
        hasStreamedText = false;
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

      case 'error':
        return [
          {
            sessionId,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: `Error: ${event.error}` },
            },
          },
        ];

      case 'compaction':
      case 'pii_redacted':
        // Internal optimization / privacy info, not relevant to ACP client
        return [];

      default:
        event satisfies never;
        return [];
    }
  };
}
