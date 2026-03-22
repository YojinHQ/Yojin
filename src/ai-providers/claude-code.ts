import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import Anthropic from '@anthropic-ai/sdk';

import { toAnthropicMessages } from './anthropic-messages.js';
import type { AIProvider } from './types.js';
import { readTokenFromKeychain } from '../auth/keychain.js';
import { getTokenManager } from '../auth/token-manager.js';
import type { AgentMessage, ContentBlock, ToolSchema } from '../core/types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const execFileAsync = promisify(execFile);
const logger = createSubsystemLogger('claude-code-provider');

/** Check whether an error indicates an expired/invalid OAuth token (401). */
function isAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes('401') || msg.includes('authentication_error') || msg.includes('OAuth token has expired');
}

/** Detect OAuth tokens by prefix. */
function isOAuthToken(token: string): boolean {
  return token.startsWith('sk-ant-oat');
}

/**
 * Claude Code identity headers required for OAuth Bearer auth.
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
 * OAuth requires tool names to be MCP-prefixed or Claude Code built-in.
 */
function toOAuthToolName(name: string): string {
  if (name.startsWith('mcp__')) return name;
  return MCP_TOOL_PREFIX + name;
}

function fromOAuthToolName(name: string): string {
  if (name.startsWith(MCP_TOOL_PREFIX)) {
    const stripped = name.slice(MCP_TOOL_PREFIX.length);
    if (!stripped.startsWith('mcp__')) return stripped;
  }
  return name;
}

/** Strip JSON Schema metadata that the Anthropic API rejects (recursive for nested objects). */
function cleanInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _s, additionalProperties: _ap, ...rest } = schema;
  if (rest.properties && typeof rest.properties === 'object') {
    rest.properties = Object.fromEntries(
      Object.entries(rest.properties as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === 'object' && v !== null ? cleanInputSchema(v as Record<string, unknown>) : v,
      ]),
    );
  }
  return rest;
}

/** Parse a stream-json event from the claude CLI. */
interface StreamEvent {
  type: string;
  subtype?: string;
  result?: string;
  is_error?: boolean;
  message?: {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * ClaudeCodeProvider — three auth modes:
 *
 *  - "api_key": Uses @anthropic-ai/sdk directly. Full tool support, multi-turn history.
 *  - "oauth":   Uses @anthropic-ai/sdk with Bearer auth (OAuth token from env or Keychain).
 *               Full tool support including vision/images. Requires MCP tool name remapping.
 *  - "cli":     Spawns `claude -p` subprocess. Text-only — no images, no tool_use.
 *               Supports streaming via `--output-format stream-json`.
 */
export class ClaudeCodeProvider implements AIProvider {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';

  private client: Anthropic | null = null;
  private authMode: 'api_key' | 'oauth' | 'cli' = 'cli';
  /** Tracks where the OAuth token was sourced so refresh only retries viable paths. */
  private oauthSource: 'env' | 'keychain' | null = null;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (apiKey) {
      this.authMode = 'api_key';
      this.client = new Anthropic({ apiKey });
    }
  }

  /**
   * Async initialization: upgrade from CLI to OAuth SDK mode when possible.
   * This enables vision (image blocks) and full tool_use support.
   * Call after construction, before first use.
   */
  async initialize(): Promise<void> {
    // Already have an SDK client (api_key mode) — nothing to upgrade
    if (this.client) return;

    // Try OAuth token from env var
    const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
    if (envToken && isOAuthToken(envToken)) {
      this.authMode = 'oauth';
      this.oauthSource = 'env';
      this.client = new Anthropic({
        apiKey: null,
        authToken: envToken,
        defaultHeaders: OAUTH_HEADERS,
      });
      logger.info('Upgraded to OAuth SDK mode (env var)');
      return;
    }

    // Try macOS Keychain
    const keychainToken = await readTokenFromKeychain();
    if (keychainToken) {
      this.authMode = 'oauth';
      this.oauthSource = 'keychain';
      this.client = new Anthropic({
        apiKey: null,
        authToken: keychainToken,
        defaultHeaders: OAUTH_HEADERS,
      });
      logger.info('Upgraded to OAuth SDK mode (macOS Keychain)');
      return;
    }

    logger.info('No OAuth token found — staying in CLI mode (no image support)');
  }

  /**
   * Re-initialize the provider with a new OAuth token.
   * Called when onboarding refreshes an expired keychain token or the user
   * configures a credential after server startup.
   */
  configureOAuthToken(token: string): void {
    this.authMode = 'oauth';
    this.oauthSource = 'env';
    this.client = new Anthropic({
      apiKey: null,
      authToken: token,
      defaultHeaders: OAUTH_HEADERS,
    });
    logger.info('Reconfigured to OAuth SDK mode (runtime)');
  }

  /**
   * Re-initialize the provider with an API key.
   * Called when onboarding validates a new API key after server startup.
   */
  configureApiKey(apiKey: string): void {
    this.authMode = 'api_key';
    this.client = new Anthropic({ apiKey });
    logger.info('Reconfigured to API key mode (runtime)');
  }

  models(): string[] {
    return ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
  }

  async isAvailable(): Promise<boolean> {
    if (this.authMode === 'api_key' || this.authMode === 'oauth') return true;
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
    if (this.client) {
      if (this.authMode === 'oauth') {
        return this.completeWithOAuth(this.client, params);
      }
      return this.completeWithSdk(this.client, params);
    }

    // CLI mode: strip tools — text only, no images.
    return this.completeWithCli(params);
  }

  async streamWithTools(params: {
    model: string;
    system?: string;
    messages: AgentMessage[];
    tools?: ToolSchema[];
    maxTokens?: number;
    onTextDelta?: (text: string) => void;
  }): Promise<{
    content: ContentBlock[];
    stopReason: string;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    if (this.client) {
      if (this.authMode === 'oauth') {
        return this.streamWithOAuth(this.client, params);
      }
      return this.streamWithSdk(this.client, params);
    }

    // CLI mode: text only, no images.
    return this.streamWithCli(params);
  }

  // ---------------------------------------------------------------------------
  // API key SDK mode — direct Anthropic API with x-api-key header
  // ---------------------------------------------------------------------------

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

  private async streamWithSdk(
    client: Anthropic,
    params: {
      model: string;
      system?: string;
      messages: AgentMessage[];
      tools?: ToolSchema[];
      maxTokens?: number;
      onTextDelta?: (text: string) => void;
    },
  ): Promise<{ content: ContentBlock[]; stopReason: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const stream = client.messages.stream({
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

    stream.on('text', (text) => {
      params.onTextDelta?.(text);
    });

    const response = await stream.finalMessage();

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

  // ---------------------------------------------------------------------------
  // OAuth SDK mode — Bearer auth with tool name remapping + system prefix
  // ---------------------------------------------------------------------------

  /**
   * Build API messages with OAuth tool name remapping.
   * Same as toAnthropicMessages but remaps tool_use/tool_result names
   * and explicitly handles image blocks.
   */
  private buildOAuthMessages(messages: AgentMessage[]): Anthropic.MessageParam[] {
    return messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role as 'user' | 'assistant', content: m.content };
      }
      const blocks = m.content.map((block) => {
        if (block.type === 'text') return { type: 'text' as const, text: block.text };
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: toOAuthToolName(block.name),
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
          return { type: 'image' as const, source: block.source };
        }
        return block;
      });
      return { role: m.role as 'user' | 'assistant', content: blocks };
    }) as Anthropic.MessageParam[];
  }

  private buildOAuthRequest(params: {
    model: string;
    system?: string;
    messages: AgentMessage[];
    tools?: ToolSchema[];
    maxTokens?: number;
  }) {
    const apiMessages = this.buildOAuthMessages(params.messages);
    // OAuth prefix MUST be the first system block — the OAuth endpoint rejects requests
    // where the Claude Code prefix is not in position 0.
    const systemParam: Anthropic.TextBlockParam[] = [
      { type: 'text' as const, text: OAUTH_SYSTEM_PREFIX.trim() },
      ...(params.system ? [{ type: 'text' as const, text: params.system }] : []),
    ];
    const toolDefs = params.tools?.length
      ? params.tools.map((t) => ({
          name: toOAuthToolName(t.name),
          description: t.description,
          input_schema: cleanInputSchema(t.input_schema as Record<string, unknown>) as Anthropic.Tool.InputSchema,
        }))
      : undefined;

    return {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: apiMessages,
      system: systemParam,
      ...(toolDefs ? { tools: toolDefs } : {}),
    };
  }

  private mapOAuthResponse(blocks: Anthropic.ContentBlock[]): ContentBlock[] {
    return blocks.map((block) => {
      if (block.type === 'text') return { type: 'text' as const, text: block.text };
      if (block.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: fromOAuthToolName(block.name),
          input: block.input,
        };
      }
      return { type: 'text' as const, text: '' };
    });
  }

  /**
   * Re-read the OAuth token and rebuild the SDK client.
   * Only Keychain tokens can be refreshed (Claude Code CLI may have renewed them).
   * Env-var tokens are static for the process lifetime — retrying would be a no-op.
   */
  private async refreshOAuthToken(): Promise<boolean> {
    if (this.oauthSource === 'env') {
      logger.warn('OAuth token from env var expired — cannot refresh a static env var');
      return false;
    }
    const keychainToken = await readTokenFromKeychain();
    if (keychainToken) {
      this.client = new Anthropic({ apiKey: null, authToken: keychainToken, defaultHeaders: OAUTH_HEADERS });
      logger.info('Refreshed OAuth client (macOS Keychain)');
      return true;
    }
    return false;
  }

  private async completeWithOAuth(
    client: Anthropic,
    params: {
      model: string;
      system?: string;
      messages: AgentMessage[];
      tools?: ToolSchema[];
      maxTokens?: number;
    },
  ): Promise<{ content: ContentBlock[]; stopReason: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const request = this.buildOAuthRequest(params);
    try {
      const response = await client.messages.create(request);
      return {
        content: this.mapOAuthResponse(response.content),
        stopReason: response.stop_reason ?? 'end_turn',
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    } catch (err) {
      if (!isAuthError(err) || !(await this.refreshOAuthToken()) || !this.client) throw err;
      const response = await this.client.messages.create(request);
      return {
        content: this.mapOAuthResponse(response.content),
        stopReason: response.stop_reason ?? 'end_turn',
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    }
  }

  private async streamWithOAuth(
    client: Anthropic,
    params: {
      model: string;
      system?: string;
      messages: AgentMessage[];
      tools?: ToolSchema[];
      maxTokens?: number;
      onTextDelta?: (text: string) => void;
    },
  ): Promise<{ content: ContentBlock[]; stopReason: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const request = this.buildOAuthRequest(params);
    try {
      const stream = client.messages.stream(request);
      stream.on('text', (text) => params.onTextDelta?.(text));
      const response = await stream.finalMessage();
      return {
        content: this.mapOAuthResponse(response.content),
        stopReason: response.stop_reason ?? 'end_turn',
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    } catch (err) {
      if (!isAuthError(err) || !(await this.refreshOAuthToken()) || !this.client) throw err;
      const stream = this.client.messages.stream(request);
      stream.on('text', (text) => params.onTextDelta?.(text));
      const response = await stream.finalMessage();
      return {
        content: this.mapOAuthResponse(response.content),
        stopReason: response.stop_reason ?? 'end_turn',
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    }
  }

  // ---------------------------------------------------------------------------
  // CLI mode — text-only subprocess
  // ---------------------------------------------------------------------------

  private buildCliPrompt(params: { system?: string; messages: AgentMessage[] }): string {
    // Format full conversation history so the CLI subprocess has context.
    const parts: string[] = [];

    if (params.system) {
      parts.push(params.system);
      parts.push('\n---\n');
    }

    for (const msg of params.messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .filter((b) => b.type === 'text')
              .map((b) => (b as { text: string }).text)
              .join('\n');
      if (text) {
        parts.push(`${role}: ${text}`);
      }
    }

    return parts.join('\n\n');
  }

  private async completeWithCli(params: {
    model: string;
    system?: string;
    messages: AgentMessage[];
    maxTokens?: number;
  }): Promise<{ content: ContentBlock[]; stopReason: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const fullPrompt = this.buildCliPrompt(params);
    const args = ['-p', fullPrompt, '--output-format', 'json', '--model', params.model];
    if (params.maxTokens) args.push('--max-tokens', String(params.maxTokens));

    const result = await this.execCliWithRefresh(args);

    return {
      content: [{ type: 'text', text: result.result ?? '' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  private async streamWithCli(params: {
    model: string;
    system?: string;
    messages: AgentMessage[];
    maxTokens?: number;
    onTextDelta?: (text: string) => void;
  }): Promise<{ content: ContentBlock[]; stopReason: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const fullPrompt = this.buildCliPrompt(params);
    const args = ['-p', fullPrompt, '--output-format', 'stream-json', '--verbose', '--model', params.model];
    if (params.maxTokens) args.push('--max-tokens', String(params.maxTokens));

    return new Promise((resolve, reject) => {
      const child = spawn('claude', args, {
        timeout: 120_000,
        cwd: '/tmp',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let fullText = '';
      let lastSeenText = '';
      let buffer = '';
      let stderr = '';
      const usage = { inputTokens: 0, outputTokens: 0 };

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();

        // Process complete JSONL lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as StreamEvent;

            if (event.type === 'assistant' && event.message?.content) {
              // Extract new text from the assistant message content
              for (const block of event.message.content) {
                if (block.type === 'text' && block.text) {
                  // The assistant event contains the full text so far, emit only the delta
                  const newText = block.text;
                  if (newText.length > lastSeenText.length) {
                    const delta = newText.slice(lastSeenText.length);
                    lastSeenText = newText;
                    fullText = newText;
                    params.onTextDelta?.(delta);
                  }
                }
              }
            } else if (event.type === 'result') {
              // Final result — use its text as the authoritative response
              if (event.result) fullText = event.result;
              if (event.usage) {
                usage.inputTokens = (event.usage.input_tokens ?? 0) + (event.usage.cache_read_input_tokens ?? 0);
                usage.outputTokens = event.usage.output_tokens ?? 0;
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer) as StreamEvent;
            if (event.type === 'result' && event.result) {
              fullText = event.result;
            }
          } catch {
            // Ignore
          }
        }

        if (code !== 0) {
          reject(new Error(`claude CLI exited with code ${code}: ${stderr || fullText.slice(0, 500)}`));
          return;
        }

        resolve({
          content: [{ type: 'text', text: fullText }],
          stopReason: 'end_turn',
          usage,
        });
      });

      child.stdin.end();
    });
  }

  /**
   * Execute the claude CLI. On 401 (expired token), attempt a token refresh
   * and retry once.
   */
  private async execCliWithRefresh(
    args: string[],
  ): Promise<{ result?: string; cost_usd?: number; duration_ms?: number; num_turns?: number }> {
    try {
      return await this.execCli(args);
    } catch (error) {
      if (!isAuthError(error)) throw error;

      const tokenManager = getTokenManager();
      if (!tokenManager.hasRefreshToken()) throw error;

      // Refresh the token and retry
      await tokenManager.refresh();
      return this.execCli(args);
    }
  }

  private execCli(
    args: string[],
  ): Promise<{ result?: string; cost_usd?: number; duration_ms?: number; num_turns?: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn('claude', args, {
        timeout: 120_000,
        cwd: '/tmp',
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

      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude CLI exited with code ${code}: ${stderr || stdout.slice(0, 500)}`));
          return;
        }
        try {
          resolve(
            JSON.parse(stdout) as { result?: string; cost_usd?: number; duration_ms?: number; num_turns?: number },
          );
        } catch {
          reject(new Error(`ClaudeCodeProvider: unexpected CLI output (not JSON): ${stdout.slice(0, 200)}`));
        }
      });

      child.stdin.end();
    });
  }
}
