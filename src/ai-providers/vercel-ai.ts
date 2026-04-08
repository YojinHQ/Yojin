import { spawn } from 'node:child_process';

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
}

/**
 * CodexProvider — spawns the Codex CLI (`codex exec`) as a subprocess.
 *
 * Mirrors the ClaudeCodeProvider CLI-mode pattern:
 * - Uses the Codex CLI's own auth (ChatGPT OAuth or API key from ~/.codex/auth.json)
 * - Text-only (no tool_use support — the CLI handles its own tools)
 * - Model selection via `-m` flag
 */
export class VercelAIProvider implements AIProvider {
  readonly id = 'codex';
  readonly name = 'Codex';

  models(): string[] {
    return ['o3', 'o4-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'codex-mini'];
  }

  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn('codex', ['--version'], { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
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
    const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check', '-m', params.model, prompt];

    logger.debug('Spawning codex exec', { model: params.model });

    return new Promise((resolve, reject) => {
      const child = spawn('codex', args, {
        timeout: 120_000,
        cwd: '/tmp',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let fullText = '';
      let buffer = '';
      let stderr = '';
      const usage = { inputTokens: 0, outputTokens: 0 };

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as CodexEvent;
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
            this.processEvent(event, { usage }, (text) => {
              fullText = text;
            });
          } catch {
            // Ignore
          }
        }

        if (code !== 0) {
          reject(new Error(`codex exec exited with code ${code}: ${stderr || fullText.slice(0, 500)}`));
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
}
