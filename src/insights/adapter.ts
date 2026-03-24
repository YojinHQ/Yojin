/**
 * Insight adapter — wires InsightStore and tools into the composition root.
 */

import { InsightStore } from './insight-store.js';
import { createInsightTools } from './tools.js';
import type { ToolDefinition } from '../core/types.js';
import { getLogger } from '../logging/index.js';

const log = getLogger().sub('insight-adapter');

interface WireInsightsOptions {
  dataRoot: string;
}

interface WireInsightsResult {
  insightStore: InsightStore;
  tools: ToolDefinition[];
}

/** Wire up insight components. Called from the composition root. */
export function wireInsights(options: WireInsightsOptions): WireInsightsResult {
  const { dataRoot } = options;

  const insightStore = new InsightStore(dataRoot);
  const tools = createInsightTools({ insightStore });

  log.info('Insight system wired');

  return { insightStore, tools };
}
