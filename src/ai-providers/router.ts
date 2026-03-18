import { type AIProvider, type AIProviderConfig, AIProviderConfigSchema } from './types.js';
import { loadJsonConfig } from '../config/config.js';
import type { AgentMessage, ContentBlock, ToolSchema } from '../core/types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('provider-router');

export interface ProviderRouterOptions {
  configPath?: string;
}

export class ProviderRouter {
  private backends = new Map<string, AIProvider>();
  private configOverride?: AIProviderConfig;
  private readonly configPath: string;
  private refreshTimer?: ReturnType<typeof setInterval>;

  constructor(options: ProviderRouterOptions = {}) {
    this.configPath = options.configPath ?? 'data/config/ai-provider.json';
  }

  registerBackend(provider: AIProvider): void {
    this.backends.set(provider.id, provider);
  }

  setConfig(config: AIProviderConfig): void {
    this.configOverride = config;
  }

  resolve(overrides?: { provider?: string; model?: string }): { provider: AIProvider; model: string } {
    const config = this.getConfig();
    const providerId = overrides?.provider ?? config.defaultProvider;
    const model = overrides?.model ?? config.defaultModel;
    if (providerId) {
      const provider = this.backends.get(providerId);
      if (!provider) {
        throw new Error(
          `AI provider "${providerId}" is not registered. Available: [${[...this.backends.keys()].join(', ')}]`,
        );
      }
      return { provider, model };
    }

    const provider = this.firstAvailable();
    if (!provider) {
      throw new Error('No AI provider registered');
    }
    return { provider, model };
  }

  async completeWithTools(params: {
    model: string;
    system?: string;
    messages: AgentMessage[];
    tools?: ToolSchema[];
    maxTokens?: number;
    providerOverrides?: { provider?: string; model?: string };
  }): Promise<{
    content: ContentBlock[];
    stopReason: string;
    usage?: { inputTokens: number; outputTokens: number };
  }> {
    const { provider, model } = this.resolve(params.providerOverrides);
    const config = this.getConfig();

    try {
      return await provider.completeWithTools({ ...params, model });
    } catch (err) {
      if (config.fallbackProvider && this.isRetryableError(err)) {
        logger.warn(`Primary provider ${provider.id} failed, trying fallback ${config.fallbackProvider}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        const fallback = this.backends.get(config.fallbackProvider);
        if (fallback) {
          const fallbackModel = config.fallbackModel ?? model;
          return await fallback.completeWithTools({ ...params, model: fallbackModel });
        }
      }
      throw err;
    }
  }

  async loadConfig(): Promise<AIProviderConfig> {
    // loadJsonConfig infers Zod input type (with optionals), but parse() applies defaults
    const config = (await loadJsonConfig(this.configPath, AIProviderConfigSchema)) as AIProviderConfig;
    this.configOverride = config;
    logger.info('Loaded AI provider config', { path: this.configPath });
    return config;
  }

  startConfigRefresh(intervalMs = 30_000): void {
    this.stopConfigRefresh();
    this.refreshTimer = setInterval(() => {
      this.loadConfig().catch((err) => {
        logger.warn('Config refresh failed, keeping previous config', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, intervalMs);
    // Allow Node to exit even if timer is running
    if (this.refreshTimer && typeof this.refreshTimer === 'object' && 'unref' in this.refreshTimer) {
      this.refreshTimer.unref();
    }
  }

  stopConfigRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private getConfig(): AIProviderConfig {
    if (this.configOverride) return this.configOverride;
    return AIProviderConfigSchema.parse({});
  }

  private firstAvailable(): AIProvider | undefined {
    return this.backends.values().next().value;
  }

  private isRetryableError(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return (
        msg.includes('network') ||
        msg.includes('econnrefused') ||
        msg.includes('timeout') ||
        msg.includes('429') ||
        msg.includes('rate limit') ||
        msg.includes('500') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('529')
      );
    }
    return false;
  }
}
