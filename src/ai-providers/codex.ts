import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

import type { AIProvider } from './types.js';
import type { AgentMessage, ContentBlock, ToolSchema } from '../core/types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('codex-provider');

/**
 * JSONL event emitted by `codex exec --json`.
 *
 * Observed event types:
 *   thread.started  — { thread_id }
 *   turn.started    — (no payload)
 *   item.completed  — { item: { id, type: "agent_message", text } }
 *   turn.completed  — { usage: { input_tokens, cached_input_tokens, output_tokens } }
 */
interface CodexEvent {
  type: string;
  item?: { type?: string; text?: string };
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
  message?: string;
  error?: { message?: string };
}

/**
 * CodexProvider — spawns the Codex CLI (`codex exec`) as a subprocess.
 *
 * Mirrors the ClaudeCodeProvider CLI-mode pattern:
 * - Uses the Codex CLI's own auth (ChatGPT OAuth or API key from ~/.codex/auth.json)
 * - Text-only (no tool_use support — the CLI handles its own tools)
 * - Model selection via `-m` flag
 */
export class CodexProvider implements AIProvider {
  readonly id = 'codex';
  readonly name = 'Codex';

  models(): string[] {
    return [
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.3-codex',
      'gpt-5.2-codex',
      'gpt-5.2',
      'gpt-5.1-codex-max',
      'gpt-5.1-codex-mini',
    ];
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      // shell: true on Windows so the `codex.cmd` PATH shim resolves.
      const child = spawn('codex', ['--version'], {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
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
    const prompt = this.buildPrompt(params);
    // Pin reasoning effort to a value supported by every codex model — overrides
    // any user-level `model_reasoning_effort` in ~/.codex/config.toml that may be
    // incompatible with the model we're calling (e.g. `xhigh` is not accepted by
    // `gpt-5.1-codex-mini`).
    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
      '-c',
      'model_reasoning_effort=high',
      '-m',
      params.model,
      prompt,
    ];

    logger.debug('Spawning codex exec', { model: params.model });

    return new Promise((resolve, reject) => {
      const child = spawn('codex', args, {
        timeout: 120_000,
        cwd: tmpdir(),
        stdio: ['ignore', 'pipe', 'pipe'],
        // Windows installs `codex` as a `.cmd` shim that the OS resolver only
        // finds when invoked through cmd.exe. Node ≥16 escapes args for cmd.exe
        // when shell is true.
        shell: process.platform === 'win32',
      });

      let fullText = '';
      let buffer = '';
      let stderr = '';
      let codexError = '';
      const usage = { inputTokens: 0, outputTokens: 0 };

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as CodexEvent;
            if (event.type === 'error') {
              codexError = this.extractErrorMessage(event);
            }
            this.processEvent(event, { usage }, (text) => {
              fullText = text;
            });
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
        // Process remaining buffer
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer) as CodexEvent;
            if (event.type === 'error') {
              codexError = this.extractErrorMessage(event);
            }
            this.processEvent(event, { usage }, (text) => {
              fullText = text;
            });
          } catch {
            // Ignore
          }
        }

        if (code !== 0) {
          const detail = codexError || stderr || fullText.slice(0, 500);
          reject(new Error(`codex exec failed: ${detail}`));
          return;
        }

        resolve({
          content: [{ type: 'text', text: fullText }],
          stopReason: 'end_turn',
          usage,
        });
      });
    });
  }

  private buildPrompt(params: { system?: string; messages: AgentMessage[] }): string {
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

  private processEvent(
    event: CodexEvent,
    state: { usage: { inputTokens: number; outputTokens: number } },
    onText: (text: string) => void,
  ): void {
    if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
      onText(event.item.text);
    }
    if (event.type === 'turn.completed' && event.usage) {
      state.usage.inputTokens = (event.usage.input_tokens ?? 0) + (event.usage.cached_input_tokens ?? 0);
      state.usage.outputTokens = event.usage.output_tokens ?? 0;
    }
  }

  /** Extract a human-readable error from a Codex error event. */
  private extractErrorMessage(event: CodexEvent): string {
    const raw = event.message ?? event.error?.message ?? '';
    // Codex wraps API errors as JSON strings inside the message field
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      return parsed.error?.message ?? raw;
    } catch {
      return raw;
    }
  }
}
