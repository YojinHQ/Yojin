/**
 * Interactive terminal chat — full agent loop with tool execution.
 *
 * Claude Code-inspired UX: animated thinking spinner, streaming text,
 * color-coded tool calls, and clear state transitions.
 */

import { createInterface } from 'node:readline';

import { anthropicPlugin } from '../../providers/anthropic/index.js';
import { buildContext } from '../composition.js';
import { runOnboarding } from './onboarding.js';
import { runAgentLoop } from '../core/agent-loop.js';
import type { AgentLoopProvider, AgentMessage, ToolDefinition } from '../core/types.js';
import { getLogger } from '../logging/index.js';

// ---------------------------------------------------------------------------
// Terminal colors & formatting
// ---------------------------------------------------------------------------

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
  warmOrange: '\x1b[38;5;173m',
  goldBold: '\x1b[1;33m',
  clearLine: '\x1b[2K\r',
};

// ---------------------------------------------------------------------------
// Thinking spinner (Claude Code style)
// ---------------------------------------------------------------------------

const SPINNER_CHARS = ['·', '✢', '✳', '✶', '✻', '✽', '✶', '✳', '✢'];
const BRAILLE_SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const THINKING_VERBS = [
  'Thinking',
  'Analyzing',
  'Reasoning',
  'Considering',
  'Processing',
  'Evaluating',
  'Examining',
  'Reflecting',
  'Computing',
  'Strategizing',
  'Synthesizing',
  'Deliberating',
  'Assessing',
  'Formulating',
  'Contemplating',
];

class ThinkingSpinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private verb: string;

  constructor() {
    this.verb = THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)];
  }

  start(): void {
    this.verb = THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)];
    this.frame = 0;
    this.render();
    this.interval = setInterval(() => this.render(), 80);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    // Clear the spinner line
    process.stdout.write(c.clearLine);
    // Clear terminal title
    process.stdout.write('\x1b]0;\x07');
  }

  private render(): void {
    const spinChar = SPINNER_CHARS[this.frame % SPINNER_CHARS.length];
    const braille = BRAILLE_SPINNER[this.frame % BRAILLE_SPINNER.length];
    process.stdout.write(`${c.clearLine}  ${c.warmOrange}${this.verb}${spinChar}${c.reset}`);
    // Update terminal title with braille spinner
    process.stdout.write(`\x1b]0;${braille} Yojin\x07`);
    this.frame++;
  }
}

// ---------------------------------------------------------------------------
// Chat entry point
// ---------------------------------------------------------------------------

export async function startChat(args: string[]): Promise<void> {
  const log = getLogger().sub('chat');

  // Parse flags before buildContext() to avoid prompting for vault passphrase
  // when args are invalid (e.g. --agent nonexistent)
  const agentId = parseFlag(args, '--agent');
  const systemPrompt = parseFlag(args, '--system');

  // Build the full dependency graph (may prompt for vault passphrase via TTY)
  const services = await buildContext();
  const { config, toolRegistry, guardRunner, outputDlp, pluginRegistry } = services;

  // Validate agent early — before loading provider plugins
  if (agentId && services.agentRegistry.getAll().every((a) => a.id !== agentId)) {
    console.error(`${c.red}error:${c.reset} Agent "${agentId}" not found`);
    process.exit(1);
  }

  // Load the anthropic provider
  pluginRegistry.loadPlugin(anthropicPlugin);
  await pluginRegistry.initializeAll(config as unknown as Record<string, unknown>);

  const providerId = parseFlag(args, '--provider') ?? config.defaultProvider ?? 'anthropic';
  const model = parseFlag(args, '--model') ?? config.defaultModel ?? 'claude-opus-4-6';

  const provider = pluginRegistry.getProvider(providerId);
  if (!provider) {
    console.error(`${c.red}error:${c.reset} Provider "${providerId}" not found`);
    await pluginRegistry.shutdownAll();
    process.exit(1);
  }

  // Verify the provider supports tool use
  const loopProvider = provider as unknown as AgentLoopProvider;
  if (typeof loopProvider.completeWithTools !== 'function') {
    console.error(`${c.red}error:${c.reset} Provider "${providerId}" does not support tool use`);
    await pluginRegistry.shutdownAll();
    process.exit(1);
  }

  // First-run onboarding: generate a personalized persona
  if (services.personaManager.isFirstRun() && process.stdin.isTTY && !args.includes('--skip-onboarding')) {
    try {
      await runOnboarding(services.personaManager, loopProvider, model);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Onboarding failed: ${msg} — using default persona`);
    }
  }

  // Resolve tools: if --agent specified, scope to that agent's tool set
  let tools: ToolDefinition[];
  let resolvedSystemPrompt =
    systemPrompt ??
    'You are Yojin, a personal AI finance agent. ' +
      'CRITICAL: You MUST use your tools to perform actions. NEVER suggest CLI commands, bash snippets, or manual steps. ' +
      'You do NOT have access to a terminal — you can ONLY act through tool calls. ' +
      'When the user asks to store a credential, call store_credential. When they ask to check something, call the relevant tool. ' +
      'If a tool returns an error (e.g. vault locked), report the error — do not suggest workarounds the user should run manually.';

  if (agentId) {
    const agentRegistry = services.agentRegistry;
    tools = agentRegistry.getToolsForAgent(agentId, toolRegistry);
    if (tools.length === 0) {
      console.error(`${c.red}error:${c.reset} Agent "${agentId}" not found or has no tools`);
      await pluginRegistry.shutdownAll();
      process.exit(1);
    }
    // Load agent system prompt if no --system override
    if (!systemPrompt) {
      const loaded = await agentRegistry.loadProfile(agentId);
      resolvedSystemPrompt = loaded.systemPrompt;
    }
  } else {
    // All tools
    tools = toolRegistry
      .toSchemas()
      .map((schema) => toolRegistry.subset([schema.name])[0])
      .filter(Boolean);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let history: AgentMessage[] = [];

  log.info('Chat session started', { provider: providerId, model, tools: tools.length, agent: agentId });

  // Header
  const modelShort = model.replace('claude-', '').replace('-20250514', '');
  console.log(`\n${c.goldBold}Yojin${c.reset} ${c.dim}\u2014 ${modelShort} \u2022 ${tools.length} tools${c.reset}`);
  if (agentId) console.log(`${c.dim}Agent: ${agentId}${c.reset}`);
  console.log(`${c.dim}Type your message. "exit" or Ctrl+C to quit.${c.reset}\n`);

  const ask = (): void => {
    rl.question(`${c.cyan}${c.bold}> ${c.reset}`, async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
        return;
      }

      // Pause readline during agent loop to avoid stdin conflicts
      rl.pause();

      const spinner = new ThinkingSpinner();
      let streamingStarted = false;
      let spinnerActive = false;

      try {
        // Start thinking spinner
        spinner.start();
        spinnerActive = true;

        const result = await runAgentLoop(trimmed, history, {
          provider: loopProvider,
          model,
          systemPrompt: resolvedSystemPrompt,
          tools,
          guardRunner,
          outputDlp,
          agentId,
          onEvent: (event) => {
            if (event.type === 'text_delta') {
              if (spinnerActive) {
                spinner.stop();
                spinnerActive = false;
              }
              if (!streamingStarted) {
                process.stdout.write(`\n${c.yellow}${c.bold}assistant${c.reset}\n`);
                streamingStarted = true;
              }
              process.stdout.write(event.text);
            }
            if (event.type === 'action') {
              if (spinnerActive) {
                spinner.stop();
                spinnerActive = false;
              }
              if (streamingStarted) {
                process.stdout.write('\n');
                streamingStarted = false;
              }
              for (const call of event.toolCalls) {
                const argStr = summarizeArgs(call.input);
                const args = argStr ? `${c.dim}(${argStr})${c.reset}` : '';
                process.stdout.write(`  ${c.warmOrange}\u25CB${c.reset} ${c.white}${call.name}${c.reset}${args}\n`);
              }
              // Restart spinner while tools execute
              spinner.start();
              spinnerActive = true;
            }
            if (event.type === 'observation') {
              if (spinnerActive) {
                spinner.stop();
                spinnerActive = false;
              }
              for (const r of event.results) {
                const preview = r.result.content.slice(0, 80).replace(/\n/g, ' ');
                if (r.result.isError) {
                  process.stdout.write(`  ${c.red}\u2717 ${r.name}${c.reset} ${c.dim}${preview}${c.reset}\n`);
                } else {
                  process.stdout.write(`  ${c.green}\u2713 ${r.name}${c.reset} ${c.dim}${preview}${c.reset}\n`);
                }
              }
              // Restart spinner while LLM processes results
              spinner.start();
              spinnerActive = true;
            }
          },
        });

        // Stop spinner if still active
        if (spinnerActive) {
          spinner.stop();
          spinnerActive = false;
        }

        history = result.messages;

        if (streamingStarted) {
          process.stdout.write('\n\n');
        } else if (result.text) {
          process.stdout.write(`\n${c.yellow}${c.bold}assistant${c.reset}\n${result.text}\n\n`);
        }

        // Usage footer
        if (result.usage.inputTokens > 0) {
          const totalTokens = result.usage.inputTokens + result.usage.outputTokens;
          process.stdout.write(
            `${c.dim}  ${result.iterations} step${result.iterations > 1 ? 's' : ''} \u2022 ${formatTokens(totalTokens)} tokens${c.reset}\n\n`,
          );
        }

        log.info('Agent loop complete', {
          iterations: result.iterations,
          usage: result.usage,
          responseLength: result.text.length,
        });
      } catch (err) {
        if (spinnerActive) {
          spinner.stop();
        }
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Agent loop error: ${msg}`);
        console.error(`\n${c.red}${c.bold}error${c.reset} ${msg}\n`);
      }

      rl.resume();
      ask();
    });
  };

  const shutdown = async (): Promise<void> => {
    process.stdout.write('\x1b]0;\x07');
    log.info('Chat session ended', { turns: history.length });
    console.log(`\n${c.dim}bye!${c.reset}`);
    await pluginRegistry.shutdownAll();
    process.exit(0);
  };

  rl.on('close', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  ask();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Summarize tool call arguments for compact display. */
function summarizeArgs(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      const truncated = s.length > 30 ? s.slice(0, 27) + '\u2026' : s;
      return `${k}: ${truncated}`;
    })
    .join(', ');
}

/** Format token count with k/M suffixes. */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;

  const parts: string[] = [];
  for (let i = idx + 1; i < args.length; i++) {
    if (args[i].startsWith('--')) break;
    parts.push(args[i]);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}
