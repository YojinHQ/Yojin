/**
 * Shared utility: convert AgentMessage[] to Anthropic API message format.
 *
 * Used by ClaudeCodeProvider (src/ai-providers/) and the Anthropic provider
 * plugin (providers/anthropic/) to avoid duplicating the same mapping logic.
 */

import Anthropic from '@anthropic-ai/sdk';

import type { AgentMessage } from '../core/types.js';

export function toAnthropicMessages(messages: AgentMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role as 'user' | 'assistant', content: m.content };
    }

    const blocks = m.content.map((block) => {
      if (block.type === 'text') return { type: 'text' as const, text: block.text };
      if (block.type === 'tool_use')
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      if (block.type === 'tool_result')
        return {
          type: 'tool_result' as const,
          tool_use_id: block.tool_use_id,
          content: block.content,
          ...(block.is_error ? { is_error: true as const } : {}),
        };
      return block;
    });

    return { role: m.role as 'user' | 'assistant', content: blocks };
  }) as Anthropic.MessageParam[];
}
