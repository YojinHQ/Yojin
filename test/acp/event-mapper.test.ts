import { describe, expect, it } from 'vitest';

import { createEventMapper } from '../../src/acp/event-mapper.js';
import type { AgentLoopEvent } from '../../src/core/types.js';

const SESSION_ID = 'test-session';

/** Helper: create a fresh mapper and map a single event. */
function mapOne(event: AgentLoopEvent) {
  return createEventMapper(SESSION_ID)(event);
}

describe('createEventMapper', () => {
  it('maps thought to agent_message_chunk', () => {
    const updates = mapOne({ type: 'thought', text: 'thinking...' });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      sessionId: SESSION_ID,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'thinking...' },
      },
    });
  });

  it('maps text_delta to agent_message_chunk', () => {
    const updates = mapOne({ type: 'text_delta', text: 'partial' });
    expect(updates).toHaveLength(1);
    expect(updates[0].update.sessionUpdate).toBe('agent_message_chunk');
  });

  it('maps action to tool_call per tool', () => {
    const updates = mapOne({
      type: 'action',
      toolCalls: [
        { id: 'tc1', name: 'analyzeRisk', input: { symbol: 'AAPL' } },
        { id: 'tc2', name: 'enrichPortfolio', input: {} },
      ],
    });
    expect(updates).toHaveLength(2);
    expect(updates[0].update).toMatchObject({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc1',
      title: 'analyzeRisk',
      status: 'in_progress',
    });
    expect(updates[1].update).toMatchObject({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc2',
      title: 'enrichPortfolio',
      status: 'in_progress',
    });
  });

  it('maps observation to tool_call_update per result', () => {
    const updates = mapOne({
      type: 'observation',
      results: [
        { toolCallId: 'tc1', name: 'analyzeRisk', result: { content: 'risk: low' } },
        { toolCallId: 'tc2', name: 'broken', result: { content: 'error', isError: true } },
      ],
    });
    expect(updates).toHaveLength(2);
    expect(updates[0].update).toMatchObject({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc1',
      status: 'completed',
    });
    expect(updates[1].update).toMatchObject({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc2',
      status: 'failed',
    });
  });

  it('maps tool_result_truncated to informational agent_message_chunk', () => {
    const updates = mapOne({
      type: 'tool_result_truncated',
      toolName: 'bigTool',
      originalChars: 100000,
      truncatedChars: 50000,
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].update.sessionUpdate).toBe('agent_message_chunk');
  });

  it('drops compaction events', () => {
    const updates = mapOne({
      type: 'compaction',
      messagesBefore: 20,
      messagesAfter: 5,
      usedLlmSummary: true,
    });
    expect(updates).toHaveLength(0);
  });

  it('drops done events (text already streamed via text_delta)', () => {
    const updates = mapOne({ type: 'done', text: 'final answer', iterations: 3 });
    expect(updates).toHaveLength(0);
  });

  it('maps error to agent_message_chunk with error message', () => {
    const updates = mapOne({ type: 'error', error: 'boom', iterations: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0].update).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Error: boom' },
    });
  });

  it('maps max_iterations to agent_message_chunk', () => {
    const updates = mapOne({ type: 'max_iterations', iterations: 20 });
    expect(updates).toHaveLength(1);
    expect(updates[0].update).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: expect.stringContaining('maximum') },
    });
  });

  it('emits thought when no text_delta has been seen (non-streaming)', () => {
    const mapper = createEventMapper(SESSION_ID);
    const updates = mapper({ type: 'thought', text: 'full response' });
    expect(updates).toHaveLength(1);
    expect(updates[0].update).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'full response' },
    });
  });

  it('suppresses thought after text_delta has been seen (streaming)', () => {
    const mapper = createEventMapper(SESSION_ID);

    const delta1 = mapper({ type: 'text_delta', text: 'hello ' });
    expect(delta1).toHaveLength(1);

    const delta2 = mapper({ type: 'text_delta', text: 'world' });
    expect(delta2).toHaveLength(1);

    // thought with assembled text — should be suppressed
    const thought = mapper({ type: 'thought', text: 'hello world' });
    expect(thought).toHaveLength(0);
  });

  it('emits text_delta regardless of previous events', () => {
    const mapper = createEventMapper(SESSION_ID);

    const delta1 = mapper({ type: 'text_delta', text: 'chunk1' });
    expect(delta1).toHaveLength(1);

    const delta2 = mapper({ type: 'text_delta', text: 'chunk2' });
    expect(delta2).toHaveLength(1);
  });

  it('each mapper instance tracks state independently', () => {
    const mapper1 = createEventMapper('session-1');
    const mapper2 = createEventMapper('session-2');

    // mapper1 sees streaming
    mapper1({ type: 'text_delta', text: 'chunk' });

    // mapper2 has NOT seen streaming — thought should emit
    const thought2 = mapper2({ type: 'thought', text: 'full text' });
    expect(thought2).toHaveLength(1);

    // mapper1 HAS seen streaming — thought should be suppressed
    const thought1 = mapper1({ type: 'thought', text: 'full text' });
    expect(thought1).toHaveLength(0);
  });

  it('resets streaming flag after done — thought emits in next iteration', () => {
    const mapper = createEventMapper(SESSION_ID);

    // Iteration 1: streaming
    mapper({ type: 'text_delta', text: 'streamed' });
    expect(mapper({ type: 'thought', text: 'streamed' })).toHaveLength(0); // suppressed
    mapper({ type: 'done', text: 'streamed', iterations: 1 });

    // Iteration 2: tool call, then non-streaming LLM response (no text_delta)
    expect(mapper({ type: 'thought', text: 'tool result analysis' })).toHaveLength(1); // should emit
  });
});
