/**
 * Configuration loading and validation.
 */

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import type { Env } from './env.js';
import { loadEnv } from './env.js';

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
 * Load config from validated environment and optional overrides.
 */
export function loadConfig(overrides?: Partial<YojinConfig>): YojinConfig {
  const env = loadEnv();

  const anthropicAuthMode = resolveAnthropicAuthMode(env);

  const raw: Partial<YojinConfig> = {
    providers: [
      {
        id: 'anthropic',
        authMode: anthropicAuthMode,
        oauthToken: env.CLAUDE_CODE_OAUTH_TOKEN,
        apiKey: env.ANTHROPIC_API_KEY,
        defaultModel: 'claude-opus-4-6',
      },
    ],
    channels: [
      {
        id: 'slack',
        enabled: !!(env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN),
        options: {
          botToken: env.SLACK_BOT_TOKEN,
          appToken: env.SLACK_APP_TOKEN,
          signingSecret: env.SLACK_SIGNING_SECRET,
        },
      },
      {
        id: 'web',
        enabled: true,
        options: {
          port: env.YOJIN_PORT ?? 3000,
        },
      },
    ],
    ...overrides,
  };

  return YojinConfigSchema.parse(raw);
}

/**
 * Determine Anthropic auth mode from validated environment.
 * Priority: CLAUDE_CODE_OAUTH_TOKEN > ANTHROPIC_API_KEY
 */
function resolveAnthropicAuthMode(env: Env): AnthropicAuthMode | undefined {
  if (env.CLAUDE_CODE_OAUTH_TOKEN) {
    return 'oauth';
  }
  if (env.ANTHROPIC_API_KEY) {
    return 'api_key';
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// JSON config loader — hot-reload on each call
// ---------------------------------------------------------------------------

/**
 * Load a typed config from a JSON file, validating with a Zod schema.
 * Returns Zod defaults when the file does not exist.
 */
export async function loadJsonConfig<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    try {
      return schema.parse({});
    } catch (err) {
      throw new Error(
        `Failed to load config from ${filePath} (file missing and schema has required fields): ${(err as Error).message}`,
        { cause: err },
      );
    }
  }

  try {
    const json: unknown = JSON.parse(raw);
    return schema.parse(json);
  } catch (err) {
    throw new Error(`Failed to load config from ${filePath}: ${(err as Error).message}`, {
      cause: err,
    });
  }
}

// ---------------------------------------------------------------------------
// Domain config schemas — minimal, grow as consuming modules are built
// ---------------------------------------------------------------------------

export const AlertsConfigSchema = z.object({
  rules: z
    .array(
      z.object({
        id: z.string(),
        type: z.string(),
        enabled: z.boolean().default(true),
        params: z.record(z.unknown()).default({}),
      }),
    )
    .default([]),
  digestSchedule: z.string().default('0 7 * * *'),
});
export type AlertsConfig = z.infer<typeof AlertsConfigSchema>;

export const OpenBBConfigSchema = z.object({
  providers: z
    .record(
      z.object({
        apiKey: z.string().optional(),
        enabled: z.boolean().default(true),
      }),
    )
    .default({}),
  defaultEquityProvider: z.string().default('fmp'),
});
export type OpenBBConfig = z.infer<typeof OpenBBConfigSchema>;

export const AIProviderConfigSchema = z.object({
  defaultProvider: z.string().default('anthropic'),
  defaultModel: z.string().default('claude-opus-4-6'),
  fallbackProvider: z.string().optional(),
  fallbackModel: z.string().optional(),
});
export type AIProviderConfig = z.infer<typeof AIProviderConfigSchema>;

export const GuardConfigSchema = z.object({
  posture: z.enum(['local', 'standard', 'unbounded']).default('local'),
  rateLimit: z
    .object({
      callsPerMinute: z.number().default(60),
    })
    .default({}),
  symbolWhitelist: z.array(z.string()).default([]),
  cooldownSeconds: z.number().default(30),
});
export type GuardConfig = z.infer<typeof GuardConfigSchema>;
