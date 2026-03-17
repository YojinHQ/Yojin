/**
 * Configuration loading and validation.
 */

import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';

export type AnthropicAuthMode = 'oauth' | 'api_key';

const ProviderConfigSchema = z.object({
  id: z.string(),
  apiKey: z.string().optional(),
  oauthToken: z.string().optional(),
  authMode: z.enum(['oauth', 'api_key']).optional(),
  defaultModel: z.string().optional(),
  options: z.record(z.unknown()).optional(),
});

const ChannelConfigSchema = z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  options: z.record(z.unknown()).optional(),
});

export const YojinConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema).default([]),
  channels: z.array(ChannelConfigSchema).default([]),
  defaultProvider: z.string().optional(),
  defaultModel: z.string().optional(),
  port: z.number().default(3000),
});

export type YojinConfig = z.infer<typeof YojinConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

/**
 * Load config from environment and optional overrides.
 */
export function loadConfig(overrides?: Partial<YojinConfig>): YojinConfig {
  loadDotenv();

  const anthropicAuthMode = resolveAnthropicAuthMode();

  const raw: Partial<YojinConfig> = {
    providers: [
      {
        id: 'anthropic',
        authMode: anthropicAuthMode,
        oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
        apiKey: process.env.ANTHROPIC_API_KEY,
        defaultModel: 'claude-sonnet-4-20250514',
      },
    ],
    channels: [
      {
        id: 'slack',
        enabled: !!process.env.SLACK_BOT_TOKEN,
        options: {
          botToken: process.env.SLACK_BOT_TOKEN,
          appToken: process.env.SLACK_APP_TOKEN,
          signingSecret: process.env.SLACK_SIGNING_SECRET,
        },
      },
      {
        id: 'web',
        enabled: true,
        options: {
          port: process.env.YOJIN_PORT ?? '3000',
        },
      },
    ],
    ...overrides,
  };

  return YojinConfigSchema.parse(raw);
}

/**
 * Determine Anthropic auth mode from available environment variables.
 * Priority: CLAUDE_CODE_OAUTH_TOKEN > ANTHROPIC_API_KEY
 */
function resolveAnthropicAuthMode(): AnthropicAuthMode | undefined {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    return 'oauth';
  }
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return 'api_key';
  }
  return undefined;
}
