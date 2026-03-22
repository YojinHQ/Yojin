import { join } from 'node:path';

import { SignalMemoryStore } from './memory-store.js';
import { ReflectionEngine } from './reflection.js';
import { createMemoryTools } from './tools.js';
import type { LlmProvider, MemoryAgentRole, PriceProvider } from './types.js';
import type { ToolDefinition } from '../core/types.js';
import { getLogger } from '../logging/index.js';
import type { PiiRedactor } from '../trust/pii/types.js';

const log = getLogger().sub('memory-adapter');

const MEMORY_ROLES: MemoryAgentRole[] = ['analyst', 'strategist', 'risk-manager'];

interface WireMemoryOptions {
  dataRoot: string;
  providerRouter?: LlmProvider;
  priceProvider?: PriceProvider;
  piiRedactor: PiiRedactor;
}

interface WireMemoryResult {
  stores: Map<MemoryAgentRole, SignalMemoryStore>;
  reflectionEngine?: ReflectionEngine;
  tools: ToolDefinition[];
}

/** Wire up all memory components. Called from the composition root. */
export async function wireMemory(options: WireMemoryOptions): Promise<WireMemoryResult> {
  const { dataRoot, providerRouter, priceProvider, piiRedactor } = options;
  const memoryDir = join(dataRoot, 'memory');

  // Create per-role stores
  const stores = new Map<MemoryAgentRole, SignalMemoryStore>();
  for (const role of MEMORY_ROLES) {
    const store = new SignalMemoryStore({ role, dataDir: memoryDir });
    await store.initialize();
    // Enforce maxEntries cap at startup — safe because no agents are running yet.
    await store.prune();
    stores.set(role, store);
  }

  // Create reflection engine (optional — requires providerRouter + priceProvider)
  const reflectionEngine =
    providerRouter && priceProvider
      ? new ReflectionEngine({
          providerRouter,
          memoryStores: stores,
          priceProvider,
          piiRedactor,
        })
      : undefined;

  // Create tools
  const tools = createMemoryTools({ stores, piiRedactor });

  log.info('Memory system wired', { roles: MEMORY_ROLES, storeCount: stores.size });

  return { stores, reflectionEngine, tools };
}

/**
 * Late-wire the ReflectionEngine after the provider is available.
 * Called from run-main.ts once ProviderRouter is constructed.
 */
export function createReflectionEngine(options: {
  stores: Map<MemoryAgentRole, SignalMemoryStore>;
  providerRouter: LlmProvider;
  priceProvider: PriceProvider;
  piiRedactor: PiiRedactor;
}): ReflectionEngine {
  return new ReflectionEngine({
    providerRouter: options.providerRouter,
    memoryStores: options.stores,
    priceProvider: options.priceProvider,
    piiRedactor: options.piiRedactor,
  });
}
