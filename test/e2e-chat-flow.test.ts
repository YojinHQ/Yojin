/**
 * E2E test — simulates a full chat flow with tool execution.
 *
 * Uses a mock provider that returns tool_use blocks, validating that
 * buildContext wires everything correctly and the agent loop executes
 * tools end-to-end (credential store, brain tools, etc.).
 */

import { describe, expect, it } from 'vitest';

import { buildContext } from '../src/composition.js';
import { runAgentLoop } from '../src/core/agent-loop.js';
import type { AgentLoopProvider, AgentMessage, ContentBlock } from '../src/core/types.js';

/**
 * Mock provider that returns scripted tool calls then a final text response.
 * Each call to completeWithTools pops the next scripted response.
 */
function createMockProvider(script: Array<{ content: ContentBlock[]; stopReason: string }>): AgentLoopProvider {
  let callIndex = 0;
  return {
    async completeWithTools() {
      const response = script[callIndex];
      if (!response) {
        return {
          content: [{ type: 'text' as const, text: 'No more scripted responses.' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      }
      callIndex++;
      return { ...response, usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
}

describe('E2E chat flow', () => {
  it('stores a credential via vault-locked stubs', async () => {
    const services = await buildContext({ skipVault: true });
    const tools = services.toolRegistry
      .toSchemas()
      .map((s) => services.toolRegistry.subset([s.name])[0])
      .filter(Boolean);

    // Script: LLM calls store_credential, gets vault-locked error, then responds
    const provider = createMockProvider([
      {
        content: [
          { type: 'text', text: 'Let me store that credential for you.' },
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'store_credential',
            input: { key: 'BINANCE_API_KEY', description: 'Binance API key for trading' },
          },
        ],
        stopReason: 'tool_use',
      },
      {
        content: [
          {
            type: 'text',
            text: 'The vault is currently locked. Please set YOJIN_VAULT_PASSPHRASE to unlock it.',
          },
        ],
        stopReason: 'end_turn',
      },
    ]);

    const history: AgentMessage[] = [];
    const events: string[] = [];

    const result = await runAgentLoop('store my binance api key', history, {
      provider,
      model: 'mock',
      tools,
      guardRunner: services.guardRunner,
      outputDlp: services.outputDlp,
      onEvent: (e) => {
        if (e.type === 'action') events.push(`action:${e.toolCalls.map((t) => t.name).join(',')}`);
        if (e.type === 'observation') events.push(`observation:${e.results.length}`);
      },
    });

    expect(events).toContain('action:store_credential');
    expect(events).toContain('observation:1');
    expect(result.iterations).toBe(2);
    expect(result.text).toContain('vault is currently locked');

    // The tool result should contain the vault-locked message
    const toolResultMsg = result.messages.find(
      (m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'),
    );
    expect(toolResultMsg).toBeDefined();
    const toolResult = (toolResultMsg!.content as ContentBlock[]).find((b) => b.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.content).toContain('Vault is locked');
      expect(toolResult.is_error).toBe(true);
    }
  });

  it('executes brain tools (get memory + update emotion)', async () => {
    const services = await buildContext({ skipVault: true });
    const tools = services.toolRegistry
      .toSchemas()
      .map((s) => services.toolRegistry.subset([s.name])[0])
      .filter(Boolean);

    const provider = createMockProvider([
      {
        content: [
          { type: 'text', text: 'Let me check my current state.' },
          { type: 'tool_use', id: 'call_1', name: 'brain_get_memory', input: {} },
          { type: 'tool_use', id: 'call_2', name: 'brain_get_emotion', input: {} },
        ],
        stopReason: 'tool_use',
      },
      {
        content: [
          { type: 'text', text: 'Now let me update my confidence based on this analysis.' },
          {
            type: 'tool_use',
            id: 'call_3',
            name: 'brain_update_emotion',
            input: {
              confidence: 0.7,
              riskAppetite: 0.4,
              reason: 'Binance integration requested — cautiously optimistic',
            },
          },
        ],
        stopReason: 'tool_use',
      },
      {
        content: [
          {
            type: 'text',
            text: 'My working memory is initialized and I have updated my confidence to 0.7 with cautious risk appetite.',
          },
        ],
        stopReason: 'end_turn',
      },
    ]);

    const events: string[] = [];
    const result = await runAgentLoop('what is your current state?', [], {
      provider,
      model: 'mock',
      tools,
      guardRunner: services.guardRunner,
      outputDlp: services.outputDlp,
      onEvent: (e) => {
        if (e.type === 'action') events.push(`action:${e.toolCalls.map((t) => t.name).join(',')}`);
      },
    });

    expect(events).toEqual(['action:brain_get_memory,brain_get_emotion', 'action:brain_update_emotion']);
    expect(result.iterations).toBe(3);
    expect(result.text).toContain('confidence to 0.7');
  });

  it('executes security audit check', async () => {
    const services = await buildContext({ skipVault: true });
    const tools = services.toolRegistry
      .toSchemas()
      .map((s) => services.toolRegistry.subset([s.name])[0])
      .filter(Boolean);

    const provider = createMockProvider([
      {
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'security_audit_check',
            input: { actionType: 'tool_call', toolName: 'store_credential' },
          },
        ],
        stopReason: 'tool_use',
      },
      {
        content: [{ type: 'text', text: 'The guard pipeline would allow storing credentials.' }],
        stopReason: 'end_turn',
      },
    ]);

    const events: Array<{ type: string; results?: Array<{ name: string; content: string }> }> = [];
    const result = await runAgentLoop('can I store a credential?', [], {
      provider,
      model: 'mock',
      tools,
      guardRunner: services.guardRunner,
      outputDlp: services.outputDlp,
      onEvent: (e) => {
        if (e.type === 'observation') {
          events.push({
            type: 'observation',
            results: e.results.map((r) => ({ name: r.name, content: r.result.content })),
          });
        }
      },
    });

    expect(result.iterations).toBe(2);
    expect(events.length).toBe(1);
    expect(events[0].results![0].content).toContain('ALLOWED');
    expect(events[0].results![0].content).toContain('tool_call');
  });

  it('scopes tools to strategist agent profile', async () => {
    const services = await buildContext({ skipVault: true });
    const { agentRegistry, toolRegistry } = services;

    const strategistTools = agentRegistry.getToolsForAgent('strategist', toolRegistry);
    const toolNames = strategistTools.map((t) => t.name);

    // Should have brain tools and portfolio reasoning
    expect(toolNames).toContain('brain_get_memory');
    expect(toolNames).toContain('brain_update_memory');
    expect(toolNames).toContain('brain_get_emotion');
    expect(toolNames).toContain('brain_update_emotion');
    expect(toolNames).toContain('brain_get_persona');
    expect(toolNames).toContain('brain_get_log');
    expect(toolNames).toContain('brain_rollback');
    expect(toolNames).toContain('portfolio_reasoning');
    expect(toolNames).toContain('security_audit_check');
    expect(toolNames).toContain('get_current_time');
    expect(toolNames).toContain('calculate');

    // Should NOT have trader/research tools
    expect(toolNames).not.toContain('connect_platform');
    expect(toolNames).not.toContain('store_credential');
    expect(toolNames).not.toContain('enrich_position');

    // Now run agent loop with scoped tools
    const provider = createMockProvider([
      {
        content: [{ type: 'tool_use', id: 'call_1', name: 'brain_get_persona', input: {} }],
        stopReason: 'tool_use',
      },
      {
        content: [{ type: 'text', text: 'I am the Strategist. My persona is loaded.' }],
        stopReason: 'end_turn',
      },
    ]);

    const result = await runAgentLoop('who are you?', [], {
      provider,
      model: 'mock',
      tools: strategistTools,
      guardRunner: services.guardRunner,
      outputDlp: services.outputDlp,
      agentId: 'strategist',
    });

    expect(result.iterations).toBe(2);
    expect(result.text).toContain('Strategist');
  });

  it('full Binance integration flow — check, store (locked), list', async () => {
    const services = await buildContext({ skipVault: true });
    const tools = services.toolRegistry
      .toSchemas()
      .map((s) => services.toolRegistry.subset([s.name])[0])
      .filter(Boolean);

    // Simulate multi-turn: agent checks if key exists, tries to store, lists all
    const provider = createMockProvider([
      // Turn 1: check if binance key exists
      {
        content: [
          { type: 'text', text: 'Let me check if you already have a Binance key.' },
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'check_credential',
            input: { key: 'BINANCE_API_KEY' },
          },
        ],
        stopReason: 'tool_use',
      },
      // Turn 2: key not found, try to store
      {
        content: [
          { type: 'text', text: 'No key found. Let me store one.' },
          {
            type: 'tool_use',
            id: 'call_2',
            name: 'store_credential',
            input: { key: 'BINANCE_API_KEY', description: 'Binance API key for trading' },
          },
        ],
        stopReason: 'tool_use',
      },
      // Turn 3: vault locked, list what we have
      {
        content: [
          { type: 'text', text: "Vault is locked. Let me show what's available." },
          { type: 'tool_use', id: 'call_3', name: 'list_credentials', input: {} },
        ],
        stopReason: 'tool_use',
      },
      // Turn 4: final response
      {
        content: [
          {
            type: 'text',
            text: 'The vault is currently locked. To store your Binance API key, set YOJIN_VAULT_PASSPHRASE and try again.',
          },
        ],
        stopReason: 'end_turn',
      },
    ]);

    const toolCalls: string[] = [];
    const toolResults: Array<{ name: string; content: string; isError?: boolean }> = [];

    const result = await runAgentLoop('connect my binance account', [], {
      provider,
      model: 'mock',
      tools,
      guardRunner: services.guardRunner,
      outputDlp: services.outputDlp,
      onEvent: (e) => {
        if (e.type === 'action') {
          for (const tc of e.toolCalls) toolCalls.push(tc.name);
        }
        if (e.type === 'observation') {
          for (const r of e.results) {
            toolResults.push({
              name: r.name,
              content: r.result.content,
              isError: r.result.isError,
            });
          }
        }
      },
    });

    // Verify tool execution order
    expect(toolCalls).toEqual(['check_credential', 'store_credential', 'list_credentials']);

    // check_credential should return vault locked
    expect(toolResults[0].name).toBe('check_credential');
    expect(toolResults[0].isError).toBe(true);
    expect(toolResults[0].content).toContain('Vault is locked');

    // store_credential should return vault locked
    expect(toolResults[1].name).toBe('store_credential');
    expect(toolResults[1].isError).toBe(true);

    // list_credentials should return vault locked
    expect(toolResults[2].name).toBe('list_credentials');
    expect(toolResults[2].isError).toBe(true);

    expect(result.iterations).toBe(4);
    expect(result.text).toContain('YOJIN_VAULT_PASSPHRASE');
  });
});
