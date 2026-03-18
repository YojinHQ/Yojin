/**
 * Interactive terminal chat — talk to the LLM directly from your terminal.
 */

import { createInterface } from 'node:readline';

import { anthropicPlugin } from '../../providers/anthropic/index.js';
import { loadConfig } from '../config/config.js';
import { getLogger } from '../logging/index.js';
import { PluginRegistry } from '../plugins/registry.js';
import type { ProviderMessage, ProviderPlugin } from '../plugins/types.js';

export async function startChat(args: string[]): Promise<void> {
  const log = getLogger().sub('chat');
  const config = loadConfig();
  const registry = new PluginRegistry();
  registry.loadPlugin(anthropicPlugin);
  await registry.initializeAll(config as unknown as Record<string, unknown>);

  const providerId = parseFlag(args, '--provider') ?? config.defaultProvider ?? 'anthropic';
  const model = parseFlag(args, '--model') ?? config.defaultModel ?? 'claude-opus-4-6';
  const systemPrompt = parseFlag(args, '--system');

  const provider = registry.getProvider(providerId);
  if (!provider) {
    console.error(`Provider "${providerId}" not found`);
    process.exit(1);
  }

  const history: ProviderMessage[] = [];
  if (systemPrompt) {
    history.push({ role: 'system', content: systemPrompt });
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  log.info('Chat session started', { provider: providerId, model, systemPrompt: !!systemPrompt });
  console.log(`\nYojin Chat — ${provider.label} / ${model}`);
  console.log('Type your message. "exit" or Ctrl+C to quit.\n');

  const ask = (): void => {
    rl.question('\x1b[36myou:\x1b[0m ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
        rl.close();
        await registry.shutdownAll();
        return;
      }

      history.push({ role: 'user', content: trimmed });
      log.info('User message', { length: trimmed.length });

      try {
        process.stdout.write('\x1b[33massistant:\x1b[0m ');
        await streamResponse(provider, model, history);
        process.stdout.write('\n\n');
        log.info('Assistant response', { length: history[history.length - 1].content.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`Stream error: ${msg}`);
        console.error(`\n\x1b[31merror:\x1b[0m ${msg}\n`);
      }

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

async function streamResponse(provider: ProviderPlugin, model: string, history: ProviderMessage[]): Promise<void> {
  let fullResponse = '';

  for await (const event of provider.stream({ model, messages: history })) {
    if (event.type === 'text_delta') {
      process.stdout.write(event.text);
      fullResponse += event.text;
    }
  }

  history.push({ role: 'assistant', content: fullResponse });
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;

  // Collect all values until the next --flag
  const parts: string[] = [];
  for (let i = idx + 1; i < args.length; i++) {
    if (args[i].startsWith('--')) break;
    parts.push(args[i]);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}
