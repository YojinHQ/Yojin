import { execFile, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import Anthropic from '@anthropic-ai/sdk';

import { toAnthropicMessages } from './anthropic-messages.js';
import type { AIProvider } from './types.js';
import { readTokenFromKeychain } from '../auth/keychain.js';
import type { AgentMessage, ContentBlock, ToolSchema } from '../core/types.js';
import { createSubsystemLogger } from '../logging/logger.js';

/**
 * Read the Claude Code token from the keychain bridge file.
 * docker/refresh-token.sh writes this file every 4 hours on the host.
 * The Docker container reads it via the ~/.yojin bind mount.
 */
async function readTokenFromKeychainFile(): Promise<string | null> {
  const yojinHome = process.env.YOJIN_HOME ?? join(homedir(), '.yojin');
  try {
    const token = (await readFile(join(yojinHome, '.keychain-token'), 'utf-8')).trim();
    return token.startsWith('sk-ant-oat') ? token : null;
  } catch {
    return null;
  }
}

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
  // The Anthropic API requires `type` to be present in every input_schema.
  if (!rest.type) rest.type = 'object';
  if (rest.properties && typeof rest.properties === 'object') {
    rest.properties = Object.fromEntries(
      Object.entries(rest.properties as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === 'object' && v !== null ? cleanInputSchema(v as Record<string, unknown>) : v,
      ]),
    );
  }
  // Anthropic API requires `type` at the top level of input_schema
  if (!rest.type) {
    rest.type = 'object';
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
/** How often to proactively re-read the macOS Keychain token (8 hours). */
const KEYCHAIN_REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000;

export class ClaudeCodeProvider implements AIProvider {
  readonly id = 'claude-code';
  readonly name = 'Claude Code';

  private client: Anthropic | null = null;
  private authMode: 'api_key' | 'oauth' | 'cli' = 'cli';
  /** Tracks where the OAuth token was sourced so refresh only retries viable paths. */
  private oauthSource: 'env' | 'keychain' | null = null;
  private tokenRefreshTimer: ReturnType<typeof setInterval> | null = null;
  /** The current OAuth token in use — compared during refresh to skip stale bridge file tokens. */
  private currentToken: string | null = null;

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

    // Try keychain bridge file (~/.yojin/.keychain-token) — written by the
    // host-side launchd agent (docker/refresh-token.sh). This is the primary
    // token source in Docker, giving the container direct Keychain access via
    // the ~/.yojin bind mount without any Anthropic OAuth complexity.
    const fileToken = await readTokenFromKeychainFile();
    if (fileToken) {
      this.authMode = 'oauth';
      this.oauthSource = 'keychain';
      this.currentToken = fileToken;
      this.client = new Anthropic({
        apiKey: null,
        authToken: fileToken,
        defaultHeaders: OAUTH_HEADERS,
      });
      logger.info('Upgraded to OAuth SDK mode (keychain bridge file)');
      this.startTokenRefreshTimer();
      return;
    }

    // Try OAuth token from env var
    const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
    if (envToken && isOAuthToken(envToken)) {
      this.authMode = 'oauth';
      this.oauthSource = 'env';
      this.currentToken = envToken;
      this.client = new Anthropic({
        apiKey: null,
        authToken: envToken,
        defaultHeaders: OAUTH_HEADERS,
      });
      logger.info('Upgraded to OAuth SDK mode (env var)');
      this.startTokenRefreshTimer();
      return;
    }

    // Try macOS Keychain
    const keychainToken = await readTokenFromKeychain();
    if (keychainToken) {
      this.authMode = 'oauth';
      this.oauthSource = 'keychain';
      this.currentToken = keychainToken;
      this.client = new Anthropic({
        apiKey: null,
        authToken: keychainToken,
        defaultHeaders: OAUTH_HEADERS,
      });
      logger.info('Upgraded to OAuth SDK mode (macOS Keychain)');
      this.startTokenRefreshTimer();
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
    this.currentToken = token;
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

  /**
   * Drop the cached SDK client after a credential removal so the provider
   * stops serving requests with the old key.
   *
   * Called from both the explicit `removeAiCredential` mutation path and
   * the auto-wipe on an api_key-mode auth failure. Without this, subsequent
   * `completeWithApiKey` calls would reuse the in-memory `Anthropic` client
   * that was constructed with the now-removed key, masking the removal
   * until the process restarts.
   *
   * In OAuth mode the credential-error handler already skips the wipe
   * (see `clearDefaultProviderCredential`), so this method is only ever
   * invoked against an api_key-mode provider.
   */
  clearCredentials(): void {
    this.client = new Anthropic({ apiKey: '' });
    logger.info('Cleared cached Anthropic client after credential removal');
  }

  /**
   * Current auth mode. Used by the credential-error handler to decide whether
   * wiping the vault credential on a 401 is the right call — in OAuth mode
   * the real credential lives in the macOS Keychain (or the keychain bridge
   * file), so wiping the vault entry would not help and would mislead the
   * "has Anthropic key" UI check.
   */
  getAuthMode(): 'api_key' | 'oauth' | 'cli' {
    return this.authMode;
  }

  models(): string[] {
    return ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];
  }

  async isAvailable(): Promise<boolean> {
    if (this.authMode === 'api_key' || this.authMode === 'oauth') return true;
    try {
      // shell: true on Windows so the `claude.cmd` PATH shim resolves.
      await execFileAsync('claude', ['--version'], { timeout: 5000, shell: process.platform === 'win32' });
      return true;
    } catch {
      return false;
    }
  }

  private async ensureCliAvailable(): Promise<void> {
    if (await this.isAvailable()) return;
    throw new Error(
      'No AI credentials configured. Set an Anthropic API key in Settings, ' +
        'or install the Claude Code CLI and log in.',
    );
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

    // CLI mode: text only — fail fast if messages contain image blocks
    const hasImages = params.messages.some(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'image'),
    );
    if (hasImages) {
      throw new Error(
        'Vision (image) content requires an API key or OAuth token. ' +
          'CLI mode does not support image blocks. Set ANTHROPIC_API_KEY or log in via Claude Code OAuth.',
      );
    }
    await this.ensureCliAvailable();
    return this.completeWithCli(params);
  }

  async streamWithTools(params: {
    model: string;
    system?: string;
    messages: AgentMessage[];
    tools?: ToolSchema[];
    maxTokens?: number;
    onTextDelta?: (text: string) => void;
    onToolUse?: (block: import('../core/types.js').ToolUseBlock) => void;
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

    // CLI mode: text only — fail fast if messages contain image blocks
    const hasImages = params.messages.some(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'image'),
    );
    if (hasImages) {
      throw new Error(
        'Vision (image) content requires an API key or OAuth token. ' +
          'CLI mode does not support image blocks. Set ANTHROPIC_API_KEY or log in via Claude Code OAuth.',
      );
    }
    await this.ensureCliAvailable();
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
              input_schema: cleanInputSchema(t.input_schema as Record<string, unknown>) as Anthropic.Tool.InputSchema,
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
      onToolUse?: (block: import('../core/types.js').ToolUseBlock) => void;
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
              input_schema: cleanInputSchema(t.input_schema as Record<string, unknown>) as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    });

    stream.on('text', (text) => {
      params.onTextDelta?.(text);
    });

    // Emit tool_use blocks as they complete during the stream
    const onToolUse = params.onToolUse;
    if (onToolUse) {
      stream.on('contentBlock', (block) => {
        if (block.type === 'tool_use') {
          onToolUse({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
        }
      });
    }

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
   * Start a background timer that proactively re-reads the OAuth token from
   * the keychain every 8 hours. Claude Code CLI rotates its own token in the
   * keychain silently, so re-reading is sufficient — we do not call the
   * OAuth refresh endpoint ourselves. If the keychain no longer holds a
   * token, keep the existing client and let the next API call surface a 401
   * that prompts the user to reconnect.
   */
  private startTokenRefreshTimer(): void {
    if (this.tokenRefreshTimer) return;
    this.tokenRefreshTimer = setInterval(() => {
      void (async () => {
        // Try keychain bridge file first, then macOS Keychain.
        // If the bridge file is stale (same token), prefer the Keychain and sync.
        const fileToken = await readTokenFromKeychainFile();
        const keychainToken = await readTokenFromKeychain();
        const freshToken = keychainToken && keychainToken !== fileToken ? keychainToken : (fileToken ?? keychainToken);
        if (freshToken) {
          this.currentToken = freshToken;
          this.client = new Anthropic({ apiKey: null, authToken: freshToken, defaultHeaders: OAUTH_HEADERS });
          logger.info('Proactively re-read OAuth token from keychain');
          // If keychain had a newer token than the bridge file, sync it.
          if (keychainToken && keychainToken !== fileToken) {
            await this.syncBridgeFile(keychainToken);
          }
        } else {
          logger.warn('Keychain has no OAuth token — user must re-login via Claude Code CLI');
        }
      })();
    }, KEYCHAIN_REFRESH_INTERVAL_MS);
  }

  /**
   * Re-read the OAuth token from the keychain and rebuild the SDK client.
   *
   * We deliberately do NOT call the Anthropic OAuth refresh endpoint here —
   * Claude Code CLI is the owner of the token rotation lifecycle, and it
   * writes the fresh token to the keychain silently. Our job is just to
   * pick up whatever is currently there.
   *
   * Returns true on a successful re-read (caller retries the request),
   * false when the keychain holds no token (caller surfaces the error so
   * the user is prompted to reconnect).
   */
  private async refreshOAuthToken(): Promise<boolean> {
    const failedToken = this.currentToken;

    // Try keychain bridge file first — but skip if it returns the same token that just failed.
    const fileToken = await readTokenFromKeychainFile();
    if (fileToken && fileToken !== failedToken) {
      this.currentToken = fileToken;
      this.client = new Anthropic({ apiKey: null, authToken: fileToken, defaultHeaders: OAUTH_HEADERS });
      logger.info('Re-read OAuth token from keychain bridge file');
      return true;
    }

    // Fall through to macOS Keychain — the source of truth for locally-running Claude Code CLI.
    const keychainToken = await readTokenFromKeychain();
    if (keychainToken && keychainToken !== failedToken) {
      this.currentToken = keychainToken;
      this.client = new Anthropic({ apiKey: null, authToken: keychainToken, defaultHeaders: OAUTH_HEADERS });
      logger.info('Re-read OAuth token from macOS Keychain (bridge file was stale)');
      // Sync the bridge file so subsequent reads don't hit the stale path again.
      await this.syncBridgeFile(keychainToken);
      return true;
    }

    logger.warn('OAuth re-read failed: no fresh token in keychain — user must re-login via Claude Code CLI');
    return false;
  }

  /**
   * Write a token to the keychain bridge file so future reads (including after
   * restart) pick up the fresh value without needing another 401 → fallback cycle.
   */
  private async syncBridgeFile(token: string): Promise<void> {
    const yojinHome = process.env.YOJIN_HOME ?? join(homedir(), '.yojin');
    try {
      await writeFile(join(yojinHome, '.keychain-token'), token, 'utf-8');
      logger.info('Synced fresh token to keychain bridge file');
    } catch {
      // Best-effort — the file may not be writable (e.g. read-only Docker mount).
    }
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
      onToolUse?: (block: import('../core/types.js').ToolUseBlock) => void;
    },
  ): Promise<{ content: ContentBlock[]; stopReason: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const request = this.buildOAuthRequest(params);

    const onToolUse = params.onToolUse;
    const wireStreamCallbacks = (s: ReturnType<typeof client.messages.stream>) => {
      s.on('text', (text: string) => params.onTextDelta?.(text));
      if (onToolUse) {
        s.on('contentBlock', (block: Anthropic.ContentBlock) => {
          if (block.type === 'tool_use') {
            onToolUse({
              type: 'tool_use',
              id: block.id,
              name: fromOAuthToolName(block.name),
              input: block.input,
            });
          }
        });
      }
    };

    try {
      const stream = client.messages.stream(request);
      wireStreamCallbacks(stream);
      const response = await stream.finalMessage();
      return {
        content: this.mapOAuthResponse(response.content),
        stopReason: response.stop_reason ?? 'end_turn',
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    } catch (err) {
      if (!isAuthError(err) || !(await this.refreshOAuthToken()) || !this.client) throw err;
      const stream = this.client.messages.stream(request);
      wireStreamCallbacks(stream);
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
        cwd: tmpdir(),
        stdio: ['pipe', 'pipe', 'pipe'],
        // Windows installs `claude` as a `.cmd` shim that the OS resolver only
        // finds when invoked through cmd.exe. Node ≥16 escapes args for cmd.exe
        // when shell is true.
        shell: process.platform === 'win32',
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
   * Execute the claude CLI. On 401 the error is re-thrown as-is so the user
   * is prompted to reconnect via Claude Code CLI (`claude login`).
   *
   * We deliberately do NOT call tokenManager.refresh() here: the Anthropic
   * OAuth endpoint rotates refresh tokens on every exchange, so refreshing
   * from Yojin would invalidate the refresh token stored in Claude Code
   * CLI's own keychain entry — and the user would be forced to re-login
   * to Claude Code CLI after every Yojin run.
   */
  private async execCliWithRefresh(
    args: string[],
  ): Promise<{ result?: string; cost_usd?: number; duration_ms?: number; num_turns?: number }> {
    return this.execCli(args);
  }

  private execCli(
    args: string[],
  ): Promise<{ result?: string; cost_usd?: number; duration_ms?: number; num_turns?: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn('claude', args, {
        timeout: 120_000,
        cwd: tmpdir(),
        stdio: ['pipe', 'pipe', 'pipe'],
        // See note in streamWithCli — Windows .cmd shims need shell: true.
        shell: process.platform === 'win32',
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
