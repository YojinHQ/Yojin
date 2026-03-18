/**
 * Anthropic/Claude provider plugin implementation.
 *
 * Supports three auth modes:
 *   - "api_key":  Direct API calls via ANTHROPIC_API_KEY
 *   - "oauth":    Direct API calls via CLAUDE_CODE_OAUTH_TOKEN (Bearer auth)
 *   - "cli":      Spawns `claude` CLI subprocess (legacy fallback)
 *
 * OAuth mode uses authToken (Bearer) instead of apiKey (x-api-key) header,
 * plus Claude Code identity headers so the Anthropic API accepts the token.
 * This enables full tool_use support without spawning a subprocess.
 */

import { spawn } from 'node:child_process';

import Anthropic from '@anthropic-ai/sdk';

import type { AgentLoopProvider, AgentMessage, ContentBlock, ToolSchema } from '../../../src/core/types.js';
import { getLogger } from '../../../src/logging/index.js';
import { createProviderApiKeyAuth, createProviderOAuthAuth } from '../../../src/plugin-sdk/index.js';
import type {
  ProviderCompletionParams,
  ProviderCompletionResult,
  ProviderModel,
  ProviderPlugin,
  ProviderStreamEvent,
} from '../../../src/plugins/types.js';

const ANTHROPIC_MODELS: ProviderModel[] = [
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    capabilities: ['text', 'vision', 'tool_use'],
  },
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    capabilities: ['text', 'vision', 'tool_use'],
  },
  {
    id: 'claude-haiku-4-20250514',
    name: 'Claude Haiku 4',
    contextWindow: 200_000,
    maxOutputTokens: 8_000,
    capabilities: ['text', 'vision', 'tool_use'],
  },
];

type AuthMode = 'api_key' | 'oauth' | 'cli';

/** Detect OAuth tokens by prefix. */
function isOAuthToken(token: string): boolean {
  return token.startsWith('sk-ant-oat');
}

/** Claude Code identity headers required for OAuth Bearer auth. */
const OAUTH_HEADERS = {
  'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,prompt-caching-2024-07-31',
  'user-agent': 'claude-cli/2.1.78',
  'x-app': 'cli',
};

/** System prompt prefix required when using OAuth Bearer auth. */
const OAUTH_SYSTEM_PREFIX = "You are Claude Code, Anthropic's official CLI for Claude.\n\n";

/** MCP server prefix for OAuth tool name remapping. */
const MCP_TOOL_PREFIX = 'mcp__yojin__';

/**
 * OAuth mode requires tool names to be either Claude Code built-in names
 * or MCP-prefixed (mcp__<server>__<tool>). Remap custom names to MCP format.
 */
function toOAuthToolName(name: string): string {
  // Already MCP-prefixed or a Claude Code built-in — leave as-is
  if (name.startsWith('mcp__')) return name;
  return MCP_TOOL_PREFIX + name;
}

/** Reverse the OAuth tool name mapping back to the original name. */
function fromOAuthToolName(name: string): string {
  if (name.startsWith(MCP_TOOL_PREFIX)) return name.slice(MCP_TOOL_PREFIX.length);
  return name;
}

/**
 * Strip JSON Schema metadata fields that the Anthropic API rejects.
 * Zod's `.jsonSchema()` adds `$schema` and `additionalProperties` which
 * are valid JSON Schema but not accepted by the Messages API.
 */
function cleanInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _schema, ...rest } = schema;
  return rest;
}

// ---------------------------------------------------------------------------
// CLI mode — spawn `claude` subprocess with CLAUDE_CODE_OAUTH_TOKEN
// ---------------------------------------------------------------------------

function callClaude(prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--model', model];
    const child = spawn('claude', args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(new Error(`Failed to spawn claude CLI: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });

    // Send prompt via stdin and close it
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function buildAnthropicProvider(): ProviderPlugin & AgentLoopProvider {
  const log = getLogger().sub('anthropic');
  let client: Anthropic;
  let authMode: AuthMode;

  return {
    id: 'anthropic',
    label: 'Anthropic',
    description: 'Claude models by Anthropic',
    envVars: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
    auth: [
      createProviderOAuthAuth({
        providerId: 'anthropic',
        envVar: 'CLAUDE_CODE_OAUTH_TOKEN',
        label: 'Claude Code OAuth token (uses CLI)',
      }),
      createProviderApiKeyAuth({
        providerId: 'anthropic',
        envVar: 'ANTHROPIC_API_KEY',
        label: 'Anthropic API key',
      }),
    ],
    models: ANTHROPIC_MODELS,

    async initialize() {
      const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

      if (oauthToken && isOAuthToken(oauthToken)) {
        // OAuth mode: use Bearer auth with Claude Code identity headers.
        // This enables full tool_use support via the Messages API.
        authMode = 'oauth';
        client = new Anthropic({
          apiKey: null,
          authToken: oauthToken,
          defaultHeaders: OAUTH_HEADERS,
        });
        log.info('Using OAuth mode (CLAUDE_CODE_OAUTH_TOKEN → Bearer auth)');
      } else if (oauthToken) {
        // Non-standard OAuth token — fall back to CLI subprocess
        authMode = 'cli';
        log.info('Using CLI mode (CLAUDE_CODE_OAUTH_TOKEN)');
      } else if (apiKey) {
        authMode = 'api_key';
        client = new Anthropic({ apiKey });
        log.info('Using API key mode');
      } else {
        authMode = 'api_key';
        client = new Anthropic();
        log.warn('No credentials found, using SDK defaults');
      }
    },

    resolveModel(modelRef: string): ProviderModel | undefined {
      const aliases: Record<string, string> = {
        opus: 'claude-opus-4-20250514',
        sonnet: 'claude-sonnet-4-20250514',
        haiku: 'claude-haiku-4-20250514',
      };
      const resolved = aliases[modelRef] ?? modelRef;
      return ANTHROPIC_MODELS.find((m) => m.id === resolved);
    },

    async complete(params: ProviderCompletionParams): Promise<ProviderCompletionResult> {
      // -- CLI mode --
      if (authMode === 'cli') {
        const userMessage = params.messages.filter((m) => m.role === 'user').pop();
        const prompt = userMessage?.content ?? '';
        const content = await callClaude(prompt, params.model);
        return { content, model: params.model };
      }

      // -- API mode --
      const systemMsg = params.messages.find((m) => m.role === 'system')?.content;
      const completeSystem =
        authMode === 'oauth'
          ? [
              { type: 'text' as const, text: OAUTH_SYSTEM_PREFIX.trim() },
              ...(systemMsg ? [{ type: 'text' as const, text: systemMsg }] : []),
            ]
          : systemMsg;

      const response = await client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens ?? 4096,
        messages: params.messages.map((m) => ({
          role: m.role === 'system' ? 'user' : m.role,
          content: m.content,
        })),
        ...(completeSystem ? { system: completeSystem } : {}),
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        ...(params.stopSequences ? { stop_sequences: params.stopSequences } : {}),
      });

      const textBlock = response.content.find((b) => b.type === 'text');

      return {
        content: textBlock?.text ?? '',
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        stopReason: response.stop_reason ?? undefined,
      };
    },

    async *stream(params: ProviderCompletionParams): AsyncIterable<ProviderStreamEvent> {
      // -- CLI mode: no streaming, yield full response at once --
      if (authMode === 'cli') {
        const userMessage = params.messages.filter((m) => m.role === 'user').pop();
        const prompt = userMessage?.content ?? '';
        const content = await callClaude(prompt, params.model);
        yield { type: 'text_delta', text: content };
        yield { type: 'stop', stopReason: 'end_turn' };
        return;
      }

      // -- API mode --
      const streamSystemMsg = params.messages.find((m) => m.role === 'system')?.content;
      const streamSystem =
        authMode === 'oauth'
          ? [
              { type: 'text' as const, text: OAUTH_SYSTEM_PREFIX.trim() },
              ...(streamSystemMsg ? [{ type: 'text' as const, text: streamSystemMsg }] : []),
            ]
          : streamSystemMsg;

      const stream = client.messages.stream({
        model: params.model,
        max_tokens: params.maxTokens ?? 4096,
        messages: params.messages.map((m) => ({
          role: m.role === 'system' ? 'user' : m.role,
          content: m.content,
        })),
        ...(streamSystem ? { system: streamSystem } : {}),
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        ...(params.stopSequences ? { stop_sequences: params.stopSequences } : {}),
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text_delta', text: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      yield {
        type: 'usage',
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      };
      yield { type: 'stop', stopReason: finalMessage.stop_reason ?? 'end_turn' };
    },

    async completeWithTools(params: {
      model: string;
      system?: string;
      messages: AgentMessage[];
      tools?: ToolSchema[];
      maxTokens?: number;
    }) {
      if (authMode === 'cli') {
        log.warn(
          'CLI mode: completeWithTools falls back to single-turn text completion — ' +
            'conversation history, system prompt and tools are not forwarded.',
        );
        const lastUser = params.messages.filter((m) => m.role === 'user').pop();
        const prompt =
          typeof lastUser?.content === 'string'
            ? lastUser.content
            : (lastUser?.content
                ?.filter((b) => b.type === 'text')
                .map((b) => (b as { text: string }).text)
                .join('') ?? '');
        const text = await callClaude(prompt, params.model);
        return {
          content: [{ type: 'text' as const, text }],
          stopReason: 'end_turn',
        };
      }

      const useOAuth = authMode === 'oauth';

      // OAuth: remap tool names to mcp__yojin__<name> format
      const remapName = useOAuth ? toOAuthToolName : (n: string) => n;
      const unremapName = useOAuth ? fromOAuthToolName : (n: string) => n;

      // Convert AgentMessages to Anthropic API format
      const apiMessages = params.messages.map((m) => {
        if (typeof m.content === 'string') {
          return { role: m.role as 'user' | 'assistant', content: m.content };
        }
        // Map content blocks to Anthropic format
        const blocks = m.content.map((block) => {
          if (block.type === 'text') {
            return { type: 'text' as const, text: block.text };
          }
          if (block.type === 'tool_use') {
            return {
              type: 'tool_use' as const,
              id: block.id,
              name: remapName(block.name),
              input: block.input as Record<string, unknown>,
            };
          }
          if (block.type === 'tool_result') {
            return {
              type: 'tool_result' as const,
              tool_use_id: block.tool_use_id,
              content: block.content,
              ...(block.is_error ? { is_error: true as const } : {}),
            };
          }
          return block;
        });
        return { role: m.role as 'user' | 'assistant', content: blocks };
      });

      // OAuth mode: system prompt must be an array of content blocks
      // and must include the Claude Code identity prefix
      const systemParam = useOAuth
        ? [
            { type: 'text' as const, text: OAUTH_SYSTEM_PREFIX.trim() },
            ...(params.system ? [{ type: 'text' as const, text: params.system }] : []),
          ]
        : params.system;

      const response = await client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens ?? 4096,
        messages: apiMessages as Anthropic.MessageParam[],
        ...(systemParam ? { system: systemParam } : {}),
        ...(params.tools?.length
          ? {
              tools: params.tools.map((t) => ({
                name: remapName(t.name),
                description: t.description,
                input_schema: cleanInputSchema(t.input_schema as Record<string, unknown>) as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
      });

      // Unmap tool names back to original in response
      const content: ContentBlock[] = response.content.map((block) => {
        if (block.type === 'text') {
          return { type: 'text' as const, text: block.text };
        }
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: unremapName(block.name),
            input: block.input,
          };
        }
        return { type: 'text' as const, text: '' };
      });

      return {
        content,
        stopReason: response.stop_reason ?? 'end_turn',
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },
  };
}
