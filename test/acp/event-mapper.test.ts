import { describe, expect, it } from 'vitest';

import { mapEventToUpdates } from '../../src/acp/event-mapper.js';
import type { AgentLoopEvent } from '../../src/core/types.js';

const SESSION_ID = 'test-session';

describe('mapEventToUpdates', () => {
  it('maps thought to agent_message_chunk', () => {
    const event: AgentLoopEvent = { type: 'thought', text: 'thinking...' };
    const updates = mapEventToUpdates(event, SESSION_ID);
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
    const event: AgentLoopEvent = { type: 'text_delta', text: 'partial' };
    const updates = mapEventToUpdates(event, SESSION_ID);
    expect(updates).toHaveLength(1);
    expect(updates[0].update.sessionUpdate).toBe('agent_message_chunk');
  });

  it('maps action to tool_call per tool', () => {
    const event: AgentLoopEvent = {
      type: 'action',
      toolCalls: [
        { id: 'tc1', name: 'analyzeRisk', input: { symbol: 'AAPL' } },
        { id: 'tc2', name: 'enrichPortfolio', input: {} },
      ],
    };
    const updates = mapEventToUpdates(event, SESSION_ID);
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
    const event: AgentLoopEvent = {
      type: 'observation',
      results: [
        { toolCallId: 'tc1', name: 'analyzeRisk', result: { content: 'risk: low' } },
        { toolCallId: 'tc2', name: 'broken', result: { content: 'error', isError: true } },
      ],
    };
    const updates = mapEventToUpdates(event, SESSION_ID);
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
    const event: AgentLoopEvent = {
      type: 'tool_result_truncated',
      toolName: 'bigTool',
      originalChars: 100000,
      truncatedChars: 50000,
    };
    const updates = mapEventToUpdates(event, SESSION_ID);
    expect(updates).toHaveLength(1);
    expect(updates[0].update.sessionUpdate).toBe('agent_message_chunk');
  });

  it('drops compaction events', () => {
    const event: AgentLoopEvent = {
      type: 'compaction',
      messagesBefore: 20,
      messagesAfter: 5,
      usedLlmSummary: true,
    };
    const updates = mapEventToUpdates(event, SESSION_ID);
    expect(updates).toHaveLength(0);
  });

  it('drops done events (text already streamed via text_delta)', () => {
    const event: AgentLoopEvent = { type: 'done', text: 'final answer', iterations: 3 };
    const updates = mapEventToUpdates(event, SESSION_ID);
    expect(updates).toHaveLength(0);
  });

  it('returns empty for error events', () => {
    const event: AgentLoopEvent = { type: 'error', error: 'boom', iterations: 1 };
    const updates = mapEventToUpdates(event, SESSION_ID);
    expect(updates).toHaveLength(0);
  });

  it('maps max_iterations to agent_message_chunk', () => {
    const event: AgentLoopEvent = { type: 'max_iterations', iterations: 20 };
    const updates = mapEventToUpdates(event, SESSION_ID);
    expect(updates).toHaveLength(1);
    expect(updates[0].update).toMatchObject({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: expect.stringContaining('maximum') },
    });
  });
});
