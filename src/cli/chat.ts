/**
 * Interactive terminal chat — full agent loop with tool execution.
 *
 * Uses buildContext() to wire all tools (credentials, brain, security audit,
 * etc.) and runAgentLoop() for the TAO cycle. Tool calls are displayed
 * inline for visibility.
 */

import { createInterface } from 'node:readline';

import { anthropicPlugin } from '../../providers/anthropic/index.js';
import { buildContext } from '../composition.js';
import { runAgentLoop } from '../core/agent-loop.js';
import type { AgentLoopProvider, AgentMessage, ToolDefinition } from '../core/types.js';
import { getLogger } from '../logging/index.js';

export async function startChat(args: string[]): Promise<void> {
  const log = getLogger().sub('chat');

  // Build the full dependency graph
  const services = await buildContext();
  const { config, toolRegistry, guardRunner, outputDlp, pluginRegistry } = services;

  // Load the anthropic provider
  pluginRegistry.loadPlugin(anthropicPlugin);
  await pluginRegistry.initializeAll(config as unknown as Record<string, unknown>);

  const providerId = parseFlag(args, '--provider') ?? config.defaultProvider ?? 'anthropic';
  const model = parseFlag(args, '--model') ?? config.defaultModel ?? 'claude-sonnet-4-20250514';
  const systemPrompt = parseFlag(args, '--system');
  const agentId = parseFlag(args, '--agent');

  const provider = pluginRegistry.getProvider(providerId);
  if (!provider) {
    console.error(`Provider "${providerId}" not found`);
    process.exit(1);
  }

  // Verify the provider supports tool use
  const loopProvider = provider as unknown as AgentLoopProvider;
  if (typeof loopProvider.completeWithTools !== 'function') {
    console.error(`Provider "${providerId}" does not support completeWithTools — tool use unavailable`);
    process.exit(1);
  }

  // Resolve tools: if --agent specified, scope to that agent's tool set
  let tools: ToolDefinition[];
  let resolvedSystemPrompt = systemPrompt;

  if (agentId) {
    const agentRegistry = services.agentRegistry;
    tools = agentRegistry.getToolsForAgent(agentId, toolRegistry);
    if (tools.length === 0) {
      console.error(`Agent "${agentId}" not found or has no tools`);
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
      .map((schema) => {
        // Reconstruct ToolDefinition from registry for runAgentLoop
        // The registry holds the full definitions; toSchemas() gives schemas.
        // We need the actual ToolDefinition[] for the agent loop.
        return toolRegistry.subset([schema.name])[0];
      })
      .filter(Boolean);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let history: AgentMessage[] = [];

  log.info('Chat session started', { provider: providerId, model, tools: tools.length, agent: agentId });
  console.log(`\nYojin Chat \u2014 ${provider.label} / ${model} (${tools.length} tools)`);
  if (agentId) console.log(`Agent: ${agentId}`);
  console.log('Type your message. "exit" or Ctrl+C to quit.\n');

  const ask = (): void => {
    rl.question('\x1b[36myou:\x1b[0m ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
        await pluginRegistry.shutdownAll();
        return;
      }

      // Pause readline during agent loop to avoid stdin conflicts
      // (readSecretFromTty and readline both use process.stdin)
      rl.pause();

      try {
        const result = await runAgentLoop(trimmed, history, {
          provider: loopProvider,
          model,
          systemPrompt: resolvedSystemPrompt,
          tools,
          guardRunner,
          outputDlp,
          agentId,
          onEvent: (event) => {
            if (event.type === 'action') {
              for (const call of event.toolCalls) {
                const argStr = summarizeArgs(call.input);
                process.stdout.write(`  \x1b[90m[tool] ${call.name}(${argStr})\x1b[0m\n`);
              }
            }
            if (event.type === 'observation') {
              for (const r of event.results) {
                const preview = r.result.content.slice(0, 120).replace(/\n/g, ' ');
                const icon = r.result.isError ? '\x1b[31m\u2717\x1b[0m' : '\x1b[32m\u2713\x1b[0m';
                process.stdout.write(`  \x1b[90m[tool] ${icon} ${preview}\x1b[0m\n`);
              }
            }
          },
        });

        history = result.messages;

        if (result.text) {
          console.log(`\x1b[33massistant:\x1b[0m ${result.text}\n`);
        }

        log.info('Agent loop complete', {
          iterations: result.iterations,
          usage: result.usage,
          responseLength: result.text.length,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Agent loop error: ${msg}`);
        console.error(`\n\x1b[31merror:\x1b[0m ${msg}\n`);
      }

      rl.resume();
      ask();
    });
  };

  rl.on('close', () => {
    log.info('Chat session ended', { turns: history.length });
    console.log('\nbye!');
    process.exit(0);
  });

  ask();
}

/** Summarize tool call arguments for compact display. */
function summarizeArgs(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      const truncated = s.length > 40 ? s.slice(0, 37) + '...' : s;
      return `${k}: ${truncated}`;
    })
    .join(', ');
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
