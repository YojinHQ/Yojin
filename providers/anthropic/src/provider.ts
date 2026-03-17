/**
 * Anthropic/Claude provider plugin implementation.
 *
 * Supports two auth modes:
 *   - "api_key": Direct API calls via ANTHROPIC_API_KEY
 *   - "cli":     Spawns `claude` CLI subprocess via CLAUDE_CODE_OAUTH_TOKEN
 *
 * CLAUDE_CODE_OAUTH_TOKEN cannot be used directly against the API — the
 * standard api.anthropic.com/v1/messages endpoint does not accept OAuth
 * Bearer tokens. Claude Code handles OAuth internally, so when an OAuth
 * token is present we delegate to the CLI.
 */

import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import type {
  ProviderPlugin,
  ProviderCompletionParams,
  ProviderCompletionResult,
  ProviderStreamEvent,
  ProviderModel,
} from "../../../src/plugins/types.js";
import {
  createProviderApiKeyAuth,
  createProviderOAuthAuth,
} from "../../../src/plugin-sdk/index.js";
import { getLogger } from "../../../src/logging/index.js";

const ANTHROPIC_MODELS: ProviderModel[] = [
  {
    id: "claude-opus-4-20250514",
    name: "Claude Opus 4",
    contextWindow: 200_000,
    maxOutputTokens: 32_000,
    capabilities: ["text", "vision", "tool_use"],
  },
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    contextWindow: 200_000,
    maxOutputTokens: 16_000,
    capabilities: ["text", "vision", "tool_use"],
  },
  {
    id: "claude-haiku-4-20250514",
    name: "Claude Haiku 4",
    contextWindow: 200_000,
    maxOutputTokens: 8_000,
    capabilities: ["text", "vision", "tool_use"],
  },
];

type AuthMode = "api_key" | "cli";

// ---------------------------------------------------------------------------
// CLI mode — spawn `claude` subprocess with CLAUDE_CODE_OAUTH_TOKEN
// ---------------------------------------------------------------------------

function callClaude(prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--model", model];
    const child = spawn("claude", args, {
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) =>
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`)),
    );
    child.on("close", (code) => {
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

export function buildAnthropicProvider(): ProviderPlugin {
  const log = getLogger().sub("anthropic");
  let client: Anthropic;
  let authMode: AuthMode;

  return {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude models by Anthropic",
    envVars: ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
    auth: [
      createProviderOAuthAuth({
        providerId: "anthropic",
        envVar: "CLAUDE_CODE_OAUTH_TOKEN",
        label: "Claude Code OAuth token (uses CLI)",
      }),
      createProviderApiKeyAuth({
        providerId: "anthropic",
        envVar: "ANTHROPIC_API_KEY",
        label: "Anthropic API key",
      }),
    ],
    models: ANTHROPIC_MODELS,

    async initialize() {
      const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

      if (oauthToken) {
        authMode = "cli";
        log.info("Using CLI mode (CLAUDE_CODE_OAUTH_TOKEN)");
      } else if (apiKey) {
        authMode = "api_key";
        client = new Anthropic({ apiKey });
        log.info("Using API key mode");
      } else {
        authMode = "api_key";
        client = new Anthropic();
        log.warn("No credentials found, using SDK defaults");
      }
    },

    resolveModel(modelRef: string): ProviderModel | undefined {
      const aliases: Record<string, string> = {
        opus: "claude-opus-4-20250514",
        sonnet: "claude-sonnet-4-20250514",
        haiku: "claude-haiku-4-20250514",
      };
      const resolved = aliases[modelRef] ?? modelRef;
      return ANTHROPIC_MODELS.find((m) => m.id === resolved);
    },

    async complete(params: ProviderCompletionParams): Promise<ProviderCompletionResult> {
      // -- CLI mode --
      if (authMode === "cli") {
        const userMessage = params.messages.filter((m) => m.role === "user").pop();
        const prompt = userMessage?.content ?? "";
        const content = await callClaude(prompt, params.model);
        return { content, model: params.model };
      }

      // -- API mode --
      const response = await client.messages.create({
        model: params.model,
        max_tokens: params.maxTokens ?? 4096,
        messages: params.messages.map((m) => ({
          role: m.role === "system" ? "user" : m.role,
          content: m.content,
        })),
        ...(params.messages.some((m) => m.role === "system")
          ? { system: params.messages.find((m) => m.role === "system")!.content }
          : {}),
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        ...(params.stopSequences ? { stop_sequences: params.stopSequences } : {}),
      });

      const textBlock = response.content.find((b) => b.type === "text");

      return {
        content: textBlock?.text ?? "",
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
      if (authMode === "cli") {
        const userMessage = params.messages.filter((m) => m.role === "user").pop();
        const prompt = userMessage?.content ?? "";
        const content = await callClaude(prompt, params.model);
        yield { type: "text_delta", text: content };
        yield { type: "stop", stopReason: "end_turn" };
        return;
      }

      // -- API mode --
      const stream = client.messages.stream({
        model: params.model,
        max_tokens: params.maxTokens ?? 4096,
        messages: params.messages.map((m) => ({
          role: m.role === "system" ? "user" : m.role,
          content: m.content,
        })),
        ...(params.messages.some((m) => m.role === "system")
          ? { system: params.messages.find((m) => m.role === "system")!.content }
          : {}),
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        ...(params.stopSequences ? { stop_sequences: params.stopSequences } : {}),
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield { type: "text_delta", text: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      yield {
        type: "usage",
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      };
      yield { type: "stop", stopReason: finalMessage.stop_reason ?? "end_turn" };
    },
  };
}
