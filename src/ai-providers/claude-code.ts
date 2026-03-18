import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import Anthropic from '@anthropic-ai/sdk';

import { toAnthropicMessages } from './anthropic-messages.js';
import type { AIProvider } from './types.js';
import type { AgentMessage, ContentBlock, ToolSchema } from '../core/types.js';

const execFileAsync = promisify(execFile);

/**
 * ClaudeCodeProvider — two auth modes:
 *
 *  - "api_key": Uses @anthropic-ai/sdk directly. Full tool support, multi-turn history.
 *  - "cli":     Spawns `claude -p` subprocess via CLAUDE_CODE_OAUTH_TOKEN. Text-only —
 *               the OAuth token cannot be used against api.anthropic.com directly.
 *
 * Tool calls always require API key mode. CLI mode is text-only.
 */
export class ClaudeCodeProvider implements AIProvider {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';

  private client: Anthropic | null = null;
  private authMode: 'api_key' | 'cli' = 'cli';

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (apiKey) {
      this.authMode = 'api_key';
      this.client = new Anthropic({ apiKey });
    } else if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
      this.authMode = 'cli';
    }
  }

  models(): string[] {
    return ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
  }

  async isAvailable(): Promise<boolean> {
    if (this.authMode === 'api_key') return true;
    try {
      await execFileAsync('claude', ['--version'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
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
    if (this.authMode === 'api_key' && this.client) {
      return this.completeWithSdk(this.client, params);
    }

    // CLI mode: cannot forward tool schemas — OAuth tokens don't work against the API.
    if (params.tools && params.tools.length > 0) {
      throw new Error(
        'ClaudeCodeProvider CLI mode (CLAUDE_CODE_OAUTH_TOKEN) does not support tool schemas. ' +
          'Set ANTHROPIC_API_KEY to enable tool use.',
      );
    }

    return this.completeWithCli(params);
  }

  private async completeWithSdk(
    client: Anthropic,
    params: {
      model: string;
      system?: string;
      messages: AgentMessage[];
      tools?: ToolSchema[];
      maxTokens?: number;
    },
  ): Promise<{ content: ContentBlock[]; stopReason: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const response = await client.messages.create({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: toAnthropicMessages(params.messages),
      ...(params.system ? { system: params.system } : {}),
      ...(params.tools?.length
        ? {
            tools: params.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.input_schema as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    });

    const content: ContentBlock[] = response.content.map((block) => {
      if (block.type === 'text') return { type: 'text' as const, text: block.text };
      if (block.type === 'tool_use')
        return { type: 'tool_use' as const, id: block.id, name: block.name, input: block.input };
      return { type: 'text' as const, text: '' };
    });

    return {
      content,
      stopReason: response.stop_reason ?? 'end_turn',
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }

  private async completeWithCli(params: {
    model: string;
    system?: string;
    messages: AgentMessage[];
    maxTokens?: number;
  }): Promise<{ content: ContentBlock[]; stopReason: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const lastUserMsg = [...params.messages].reverse().find((m) => m.role === 'user');
    const promptText =
      typeof lastUserMsg?.content === 'string'
        ? lastUserMsg.content
        : (lastUserMsg?.content
            ?.filter((b) => b.type === 'text')
            .map((b) => (b as { text: string }).text)
            .join('\n') ?? '');

    const args = ['-p', promptText, '--output-format', 'json', '--model', params.model];
    if (params.system) args.push('--system-prompt', params.system);
    if (params.maxTokens) args.push('--max-tokens', String(params.maxTokens));

    const { stdout } = await execFileAsync('claude', args, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    let result: { result?: string; cost_usd?: number; duration_ms?: number; num_turns?: number };
    try {
      result = JSON.parse(stdout) as typeof result;
    } catch {
      throw new Error(`ClaudeCodeProvider: unexpected CLI output (not JSON): ${stdout.slice(0, 200)}`);
    }

    return {
      content: [{ type: 'text', text: result.result ?? '' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
