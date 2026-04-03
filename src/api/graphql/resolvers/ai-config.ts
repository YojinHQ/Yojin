/**
 * AI config resolver — read and update the active AI provider config at runtime.
 *
 * Writes to data/config/ai-provider.json, then hot-reloads the ProviderRouter
 * so changes take effect immediately without a restart.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ClaudeCodeProvider } from '../../../ai-providers/claude-code.js';
import type { ProviderRouter } from '../../../ai-providers/router.js';
import { AIProviderConfigSchema } from '../../../config/config.js';
import { createSubsystemLogger } from '../../../logging/logger.js';
import { resolveDataRoot } from '../../../paths.js';
import type { EncryptedVault } from '../../../trust/vault/vault.js';

const logger = createSubsystemLogger('ai-config');

// ---------------------------------------------------------------------------
// Module-level state — wired at startup from composition
// ---------------------------------------------------------------------------

let router: ProviderRouter | null = null;
let vault: EncryptedVault | undefined;
let claudeCodeProvider: ClaudeCodeProvider | undefined;

export function setAiConfigProviderRouter(r: ProviderRouter): void {
  router = r;
}

export function setAiConfigVault(v: EncryptedVault): void {
  vault = v;
}

export function setAiConfigClaudeCodeProvider(ccp: ClaudeCodeProvider): void {
  claudeCodeProvider = ccp;
}

// ---------------------------------------------------------------------------
// GraphQL types (mirrored from schema)
// ---------------------------------------------------------------------------

interface AiConfigGql {
  defaultModel: string;
  defaultProvider: string;
  hasAnthropicKey: boolean;
  hasOpenaiKey: boolean;
}

interface SaveAiCredentialResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Vault key mapping
// ---------------------------------------------------------------------------

const PROVIDER_VAULT_KEYS: Record<string, { vaultKey: string; envKey: string }> = {
  'claude-code': { vaultKey: 'anthropic_api_key', envKey: 'ANTHROPIC_API_KEY' },
  codex: { vaultKey: 'openai_api_key', envKey: 'OPENAI_API_KEY' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hasVaultKey(key: string): Promise<boolean> {
  if (!vault?.isUnlocked) return false;
  return vault.has(key);
}

async function readAiConfig(): Promise<AiConfigGql> {
  const configPath = join(resolveDataRoot(), 'config', 'ai-provider.json');
  let defaultModel: string;
  let defaultProvider: string;
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = AIProviderConfigSchema.parse(JSON.parse(raw));
    defaultModel = parsed.defaultModel;
    defaultProvider = parsed.defaultProvider;
  } catch {
    const defaults = AIProviderConfigSchema.parse({});
    defaultModel = defaults.defaultModel;
    defaultProvider = defaults.defaultProvider;
  }

  const hasAnthropicKey =
    !!process.env.ANTHROPIC_API_KEY ||
    !!process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    (await hasVaultKey('anthropic_api_key')) ||
    (await hasVaultKey('anthropic_oauth_token'));

  const hasOpenaiKey = !!process.env.OPENAI_API_KEY || (await hasVaultKey('openai_api_key'));

  return { defaultModel, defaultProvider, hasAnthropicKey, hasOpenaiKey };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export async function aiConfigQuery(): Promise<AiConfigGql> {
  return readAiConfig();
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function saveAiConfigMutation(
  _: unknown,
  args: { input: { defaultModel: string; defaultProvider?: string } },
): Promise<AiConfigGql> {
  const { defaultModel, defaultProvider } = args.input;
  const configPath = join(resolveDataRoot(), 'config', 'ai-provider.json');

  // Read existing config to preserve other fields (fallback, etc.)
  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(configPath, 'utf-8');
    existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // File may not exist yet — start fresh
  }

  const updated: Record<string, unknown> = { ...existing, defaultModel };
  if (defaultProvider) {
    updated.defaultProvider = defaultProvider;
  }
  await mkdir(join(resolveDataRoot(), 'config'), { recursive: true });
  await writeFile(configPath, JSON.stringify(updated, null, 2), 'utf-8');

  // Hot-reload the router so the new model takes effect immediately
  if (router) {
    try {
      await router.loadConfig();
    } catch (err) {
      logger.warn('Failed to hot-reload AI config after save', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const resolvedProvider = defaultProvider ?? (existing.defaultProvider as string | undefined) ?? 'claude-code';
  logger.info('AI config saved', { defaultModel, defaultProvider: resolvedProvider });

  return readAiConfig();
}

export async function saveAiCredentialMutation(
  _: unknown,
  args: { provider: string; apiKey: string },
): Promise<SaveAiCredentialResult> {
  const mapping = PROVIDER_VAULT_KEYS[args.provider];
  if (!mapping) {
    return { success: false, error: `Unknown provider: ${args.provider}` };
  }

  const apiKey = args.apiKey.trim();
  if (!apiKey) {
    return { success: false, error: 'API key cannot be empty' };
  }

  // Validate Anthropic key format
  if (args.provider === 'claude-code' && !apiKey.startsWith('sk-ant-')) {
    return { success: false, error: 'Anthropic API keys start with sk-ant-' };
  }

  // Store in vault if available
  if (vault?.isUnlocked) {
    await vault.set(mapping.vaultKey, apiKey);
  }

  // Set in process env so the provider picks it up
  process.env[mapping.envKey] = apiKey;

  // Reconfigure the provider immediately
  if (args.provider === 'claude-code' && claudeCodeProvider) {
    claudeCodeProvider.configureApiKey(apiKey);
  }

  // Hot-reload the router
  if (router) {
    try {
      await router.loadConfig();
    } catch {
      // Best-effort
    }
  }

  logger.info('AI credential saved', { provider: args.provider });
  return { success: true };
}

export async function removeAiCredentialMutation(
  _: unknown,
  args: { provider: string },
): Promise<SaveAiCredentialResult> {
  const mapping = PROVIDER_VAULT_KEYS[args.provider];
  if (!mapping) {
    return { success: false, error: `Unknown provider: ${args.provider}` };
  }

  // Remove from vault
  if (vault?.isUnlocked && (await vault.has(mapping.vaultKey))) {
    await vault.delete(mapping.vaultKey);
  }

  // Remove from process env
  process.env[mapping.envKey] = '';

  logger.info('AI credential removed', { provider: args.provider });
  return { success: true };
}
