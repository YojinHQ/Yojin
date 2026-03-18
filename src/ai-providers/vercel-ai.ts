import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { generateText, jsonSchema } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';

import type { AIProvider } from './types.js';
import type { AgentMessage, ContentBlock, ToolSchema } from '../core/types.js';

export class VercelAIProvider implements AIProvider {
  readonly id = 'vercel-ai';
  readonly name = 'Vercel AI SDK';

  models(): string[] {
    return ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'gpt-4o', 'gpt-4o-mini'];
  }

  async isAvailable(): Promise<boolean> {
    return !!(process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  }

  async completeWithTools(params: {
    model: string;
    system?: string;
    messages: AgentMessage[];
    tools?: ToolSchema[];
    maxTokens?: number;
  }): Promise<{
    content: ContentBlock[];
    stopReason: string;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    const modelInstance = this.resolveModel(params.model);

    // Build a lookup map from tool call ID → tool name, needed for tool-result parts.
    const toolCallNames = new Map<string, string>();
    for (const m of params.messages) {
      if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.type === 'tool_use') {
            toolCallNames.set(block.id, block.name);
          }
        }
      }
    }

    type AssistantPart =
      | { type: 'text'; text: string }
      | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown };
    type UserPart =
      | { type: 'text'; text: string }
      | { type: 'tool-result'; toolCallId: string; toolName: string; result: string; isError: boolean | undefined };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = params.messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }

      if (m.role === 'assistant') {
        const parts: AssistantPart[] = [];
        for (const block of m.content) {
          if (block.type === 'text') parts.push({ type: 'text', text: block.text });
          else if (block.type === 'tool_use')
            parts.push({ type: 'tool-call', toolCallId: block.id, toolName: block.name, args: block.input });
        }
        return { role: 'assistant', content: parts };
      }

      // user message — may contain text or tool_result blocks
      const parts: UserPart[] = [];
      for (const block of m.content) {
        if (block.type === 'text') parts.push({ type: 'text', text: block.text });
        else if (block.type === 'tool_result')
          parts.push({
            type: 'tool-result',
            toolCallId: block.tool_use_id,
            toolName: toolCallNames.get(block.tool_use_id) ?? 'unknown',
            result: block.content,
            isError: block.is_error,
          });
      }
      return { role: 'user', content: parts };
    });

    const tools: ToolSet = {};
    for (const t of params.tools ?? []) {
      tools[t.name] = {
        description: t.description,
        inputSchema: jsonSchema(t.input_schema),
      };
    }

    const result = await generateText({
      model: modelInstance,
      system: params.system,
      messages,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      maxOutputTokens: params.maxTokens,
    });

    const content: ContentBlock[] = [];
    if (result.text) {
      content.push({ type: 'text', text: result.text });
    }
    for (const call of result.toolCalls) {
      content.push({
        type: 'tool_use',
        id: call.toolCallId,
        name: call.toolName,
        input: call.input,
      });
    }

    return {
      content,
      stopReason: result.finishReason === 'tool-calls' ? 'tool_use' : 'end_turn',
      usage: result.usage
        ? { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens ?? 0 }
        : undefined,
    };
  }

  private resolveModel(modelId: string): LanguageModel {
    if (modelId.startsWith('claude')) {
      return anthropic(modelId);
    }
    if (modelId.startsWith('gpt')) {
      return openai(modelId);
    }
    throw new Error(
      `VercelAIProvider: unsupported model ID "${modelId}". Add a resolver branch for this model family.`,
    );
  }
}
