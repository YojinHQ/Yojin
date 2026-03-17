/**
 * Environment variable validation.
 *
 * Single source of truth for all env vars the app reads.
 * Validates at startup so malformed values fail fast instead of
 * causing subtle bugs deep in the call stack.
 */

import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';

/**
 * Treat empty / whitespace-only strings as undefined — `.env` files
 * often have `KEY=` lines that should be interpreted as "not set".
 */
const envString = z
  .string()
  .optional()
  .transform((s) => (s?.trim() === '' ? undefined : s?.trim()));

/** String that must start with the given prefix when present. */
const prefixed = (prefix: string) =>
  envString.pipe(
    z.union([z.string().startsWith(prefix, `Must start with "${prefix}"`), z.undefined()]),
  );

export const EnvSchema = z.object({
  // ── Anthropic / Claude ──────────────────────────────────
  ANTHROPIC_API_KEY: envString,
  CLAUDE_CODE_OAUTH_TOKEN: envString,

  // ── Slack ───────────────────────────────────────────────
  SLACK_BOT_TOKEN: prefixed('xoxb-'),
  SLACK_APP_TOKEN: prefixed('xapp-'),
  SLACK_SIGNING_SECRET: envString,

  // ── Server ──────────────────────────────────────────────
  YOJIN_PORT: z
    .string()
    .optional()
    .transform((s) => (s ? Number(s) : undefined))
    .pipe(z.number().int().min(1).max(65535).optional()),

  YOJIN_API_PORT: z
    .string()
    .optional()
    .transform((s) => (s ? Number(s) : undefined))
    .pipe(z.number().int().min(1).max(65535).optional()),

  YOJIN_HOST: envString,

  // ── Logging / Runtime ───────────────────────────────────
  YOJIN_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).optional(),

  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let _cached: Env | undefined;

/**
 * Load `.env` then validate all env vars through the Zod schema.
 * Result is cached — safe to call multiple times.
 */
export function loadEnv(): Env {
  if (_cached) return _cached;

  loadDotenv();

  const result = EnvSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  _cached = result.data;
  return _cached;
}

/**
 * Reset the cached env (for testing only).
 */
export function _resetEnvCache(): void {
  _cached = undefined;
}
