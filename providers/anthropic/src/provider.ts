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

import { execFile, spawn } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';

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
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    capabilities: ['text', 'vision', 'tool_use'],
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    capabilities: ['text', 'vision', 'tool_use'],
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    maxOutputTokens: 8_000,
    capabilities: ['text', 'vision', 'tool_use'],
  },
];

type AuthMode = 'api_key' | 'oauth' | 'cli';

/**
 * Detect OAuth tokens by prefix.
 * Anthropic's OAuth tokens use the 'sk-ant-oat' prefix as of 2025-04.
 * If this prefix changes, update here and in readTokenFromKeychain().
 */
function isOAuthToken(token: string): boolean {
  return token.startsWith('sk-ant-oat');
}

/**
 * Claude Code identity headers required for OAuth Bearer auth.
 * Version pinned to the Claude Code CLI release this OAuth flow was
 * validated against. Update alongside anthropic-beta feature flags.
 */
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

/**
 * Reverse the OAuth tool name mapping back to the original name.
 * Only strips the prefix if toOAuthToolName would have added it —
 * i.e. the original name did NOT already start with mcp__.
 */
function fromOAuthToolName(name: string): string {
  if (name.startsWith(MCP_TOOL_PREFIX)) {
    const stripped = name.slice(MCP_TOOL_PREFIX.length);
    // If stripped name still starts with mcp__, the original was already prefixed
    if (!stripped.startsWith('mcp__')) return stripped;
  }
  return name;
}

const execFileAsync = promisify(execFile);

/**
 * Attempt to read Claude Code OAuth token from macOS Keychain.
 * Returns the access token or null if unavailable.
 * Uses async execFile to avoid blocking the event loop.
 */
async function readTokenFromKeychain(): Promise<string | null> {
  if (platform() !== 'darwin') return null;
  try {
    const { stdout } = await execFileAsync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      {
        encoding: 'utf8',
        timeout: 3000,
      },
    );
    const parsed = JSON.parse(stdout.trim()) as { claudeAiOauth?: { accessToken?: string } };
    const token = parsed.claudeAiOauth?.accessToken;
    return token && isOAuthToken(token) ? token : null;
  } catch {
    return null;
  }
}

/**
 * Strip JSON Schema metadata fields that the Anthropic API rejects.
 * Zod's `.jsonSchema()` adds `$schema` and `additionalProperties` which
 * are valid JSON Schema but not accepted by the Messages API.
 */
function cleanInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _schema, additionalProperties: _additionalProperties, ...rest } = schema;
  // Anthropic API requires `type` at the top level of input_schema
  if (!rest.type) {
    rest.type = 'object';
  }
  return rest;
}

/** Build Anthropic API messages from AgentMessages, applying optional name remapping. */
function buildApiMessages(messages: AgentMessage[], remapName: (n: string) => string): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role as 'user' | 'assistant', content: m.content };
    }
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
      if (block.type === 'image') {
        return {
          type: 'image' as const,
          source: block.source,
        };
      }
      return block;
    });
    return { role: m.role as 'user' | 'assistant', content: blocks };
  }) as Anthropic.MessageParam[];
}

/** Build the system parameter, prepending the OAuth prefix when needed. */
function buildSystemParam(
  system: string | undefined,
  useOAuth: boolean,
): string | Anthropic.TextBlockParam[] | undefined {
  if (useOAuth) {
    return [
      { type: 'text' as const, text: OAUTH_SYSTEM_PREFIX.trim() },
      ...(system ? [{ type: 'text' as const, text: system }] : []),
    ];
  }
  return system;
}

/** Map Anthropic response content blocks back to our ContentBlock type. */
function mapResponseContent(blocks: Anthropic.ContentBlock[], unremapName: (n: string) => string): ContentBlock[] {
  return blocks.map((block) => {
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
}

/** Build Anthropic tool definitions with optional name remapping. */
function buildToolDefs(
  tools: ToolSchema[] | undefined,
  remapName: (n: string) => string,
): Anthropic.Tool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: remapName(t.name),
    description: t.description,
    input_schema: cleanInputSchema(t.input_schema as Record<string, unknown>) as Anthropic.Tool.InputSchema,
  }));
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

const identity = (n: string): string => n;

/** Extract the last user message as a plain string (for CLI fallback). */
function extractLastUserPrompt(messages: { role: string; content: string | ContentBlock[] }[]): string {
  const lastUser = messages.filter((m) => m.role === 'user').pop();
  if (!lastUser) return '';
  if (typeof lastUser.content === 'string') return lastUser.content;
  return lastUser.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('');
}

export function buildAnthropicProvider(): ProviderPlugin & AgentLoopProvider {
  const log = getLogger().sub('anthropic');
  let client: Anthropic;
  let authMode: AuthMode;

  /** Build the shared API request object for complete/stream. */
  function buildBaseRequest(params: ProviderCompletionParams) {
    const systemMsg = params.messages.find((m) => m.role === 'system')?.content;
    const systemParam = buildSystemParam(systemMsg, authMode === 'oauth');
    return {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: params.messages.map((m) => ({
        role: (m.role === 'system' ? 'user' : m.role) as 'user' | 'assistant',
        content: m.content,
      })),
      ...(systemParam ? { system: systemParam } : {}),
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.stopSequences ? { stop_sequences: params.stopSequences } : {}),
    };
  }

  /** Build the shared API request object for completeWithTools/streamWithTools. */
  function buildToolRequest(params: {
    model: string;
    system?: string;
    messages: AgentMessage[];
    tools?: ToolSchema[];
    maxTokens?: number;
  }) {
    const useOAuth = authMode === 'oauth';
    const remapName = useOAuth ? toOAuthToolName : identity;
    const apiMessages = buildApiMessages(params.messages, remapName);
    const systemParam = buildSystemParam(params.system, useOAuth);
    const toolDefs = buildToolDefs(params.tools, remapName);
    return {
      request: {
        model: params.model,
        max_tokens: params.maxTokens ?? 4096,
        messages: apiMessages,
        ...(systemParam ? { system: systemParam } : {}),
        ...(toolDefs ? { tools: toolDefs } : {}),
      },
      unremapName: useOAuth ? fromOAuthToolName : identity,
    };
  }

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
        authMode = 'oauth';
        client = new Anthropic({
          apiKey: null,
          authToken: oauthToken,
          defaultHeaders: OAUTH_HEADERS,
        });
        log.info('Using OAuth mode (CLAUDE_CODE_OAUTH_TOKEN → Bearer auth)');
      } else if (apiKey) {
        authMode = 'api_key';
        client = new Anthropic({ apiKey });
        log.info('Using API key mode');
      } else {
        if (oauthToken) {
          log.warn(
            'CLAUDE_CODE_OAUTH_TOKEN set but does not match expected OAuth format (sk-ant-oat*) — trying Keychain fallback',
          );
        }
        // Try macOS Keychain as fallback (reads Claude Code's stored OAuth token)
        const keychainToken = await readTokenFromKeychain();
        if (keychainToken) {
          authMode = 'oauth';
          client = new Anthropic({
            apiKey: null,
            authToken: keychainToken,
            defaultHeaders: OAUTH_HEADERS,
          });
          log.info('Using OAuth mode (macOS Keychain → Bearer auth)');
        } else if (oauthToken) {
          // Non-standard OAuth token — fall back to CLI subprocess
          authMode = 'cli';
          log.info('Using CLI mode (CLAUDE_CODE_OAUTH_TOKEN)');
        } else {
          log.error(
            'No credentials found. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, ' +
              'or log in to Claude Code (the token is read from macOS Keychain).',
          );
          throw new Error('No Anthropic credentials found. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN.');
        }
      }
    },

    resolveModel(modelRef: string): ProviderModel | undefined {
      const aliases: Record<string, string> = {
        opus: 'claude-opus-4-6',
        sonnet: 'claude-sonnet-4-6',
        haiku: 'claude-haiku-4-5-20251001',
      };
      const resolved = aliases[modelRef] ?? modelRef;
      return ANTHROPIC_MODELS.find((m) => m.id === resolved);
    },

    async complete(params: ProviderCompletionParams): Promise<ProviderCompletionResult> {
      // -- CLI mode --
      if (authMode === 'cli') {
        const content = await callClaude(extractLastUserPrompt(params.messages), params.model);
        return { content, model: params.model };
      }

      // -- API mode --
      const response = await client.messages.create(buildBaseRequest(params));

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
        const content = await callClaude(extractLastUserPrompt(params.messages), params.model);
        yield { type: 'text_delta', text: content };
        yield { type: 'stop', stopReason: 'end_turn' };
        return;
      }

      // -- API mode --
      const stream = client.messages.stream(buildBaseRequest(params));

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
        // CLI mode cannot forward image blocks — fail fast if any are present
        const hasImages = params.messages.some(
          (m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'image'),
        );
        if (hasImages) {
          throw new Error(
            'Vision (image) content requires an API key or OAuth token. ' +
              'CLI mode does not support image blocks. Set ANTHROPIC_API_KEY or log in via Claude Code OAuth.',
          );
        }

        log.warn(
          'CLI mode: completeWithTools falls back to single-turn text completion — ' +
            'conversation history, system prompt, tools, and image blocks are not forwarded.',
        );
        const text = await callClaude(extractLastUserPrompt(params.messages), params.model);
        return {
          content: [{ type: 'text' as const, text }],
          stopReason: 'end_turn',
        };
      }

      const { request, unremapName } = buildToolRequest(params);

      const response = await client.messages.create(request);

      return {
        content: mapResponseContent(response.content, unremapName),
        stopReason: response.stop_reason ?? 'end_turn',
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    },

    async streamWithTools(params: {
      model: string;
      system?: string;
      messages: AgentMessage[];
      tools?: ToolSchema[];
      maxTokens?: number;
      onTextDelta?: (text: string) => void;
    }) {
      if (authMode === 'cli') {
        // CLI mode: no streaming, fall back to completeWithTools
        return this.completeWithTools(params);
      }

      const { request, unremapName } = buildToolRequest(params);

      const stream = client.messages.stream(request);

      stream.on('text', (text) => {
        params.onTextDelta?.(text);
      });

      const finalMessage = await stream.finalMessage();

      return {
        content: mapResponseContent(finalMessage.content, unremapName),
        stopReason: finalMessage.stop_reason ?? 'end_turn',
        usage: {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
        },
      };
    },
  };
}
