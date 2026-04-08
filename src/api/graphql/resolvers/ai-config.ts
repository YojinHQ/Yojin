/**
 * AI config resolver — read and update the active AI provider config at runtime.
 *
 * Writes to data/config/ai-provider.json, then hot-reloads the ProviderRouter
 * so changes take effect immediately without a restart.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ClaudeCodeProvider } from '../../../ai-providers/claude-code.js';
import { registerCredentialErrorHandler } from '../../../ai-providers/credential-error.js';
import type { ProviderRouter } from '../../../ai-providers/router.js';
import { readTokenFromKeychain } from '../../../auth/keychain.js';
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
  // Register the credential cleanup handler so agent-loop (and all BE flows)
  // can trigger it without depending on the API/resolver layer.
  registerCredentialErrorHandler(clearDefaultProviderCredential);
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
  hasAnthropicApiKey: boolean;
  hasOpenaiKey: boolean;
}

interface SaveAiCredentialResult {
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Vault key mapping
// ---------------------------------------------------------------------------

/**
 * Credential variants per provider. The first entry is the "primary" mapping
 * that `saveAiCredential` writes to; subsequent entries are additional forms
 * (e.g. OAuth tokens) that coexist with the primary and must all be cleared
 * when the credential is removed. Save paths use `[0]`, delete paths iterate.
 */
const PROVIDER_VAULT_KEYS: Record<string, ReadonlyArray<{ vaultKey: string; envKey: string }>> = {
  'claude-code': [
    { vaultKey: 'anthropic_api_key', envKey: 'ANTHROPIC_API_KEY' },
    { vaultKey: 'anthropic_oauth_token', envKey: 'CLAUDE_CODE_OAUTH_TOKEN' },
  ],
  codex: [{ vaultKey: 'openai_api_key', envKey: 'OPENAI_API_KEY' }],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function hasVaultKey(key: string): Promise<boolean> {
  if (!vault?.isUnlocked) return false;
  return vault.has(key);
}

/**
 * Delete the stored credential for a provider (vault + env var).
 * Used both by the GraphQL removeAiCredential mutation and by automatic
 * credential invalidation when a provider returns an auth error.
 *
 * Clears every credential variant listed in `PROVIDER_VAULT_KEYS[providerId]`
 * (for claude-code that's both the API-key entry and the OAuth-token entry)
 * and then resets the in-memory provider so its cached SDK client stops
 * serving requests with the now-removed credential.
 */
async function deleteProviderCredential(providerId: string): Promise<void> {
  const mappings = PROVIDER_VAULT_KEYS[providerId];
  if (!mappings) return;
  for (const mapping of mappings) {
    if (vault?.isUnlocked && (await vault.has(mapping.vaultKey))) {
      await vault.delete(mapping.vaultKey);
    }
    process.env[mapping.envKey] = '';
  }
  // Reset the in-memory provider so subsequent requests don't reuse the
  // cached Anthropic client built with the removed credential. Mirrors the
  // runtime reconfiguration that saveAiCredentialMutation does after writes.
  if (providerId === 'claude-code') {
    claudeCodeProvider?.clearCredentials();
  }
  logger.info('Provider credential removed', { provider: providerId });
}

/**
 * Read the currently configured default provider id from disk.
 * Falls back to 'claude-code' if the config is absent or unparseable.
 */
async function readDefaultProviderId(): Promise<string> {
  const configPath = join(resolveDataRoot(), 'config', 'ai-provider.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    const parsed = AIProviderConfigSchema.parse(JSON.parse(raw));
    return parsed.defaultProvider;
  } catch {
    return 'claude-code';
  }
}

/**
 * Programmatically clear the default provider's credential.
 * Called automatically when the provider returns an auth/invalid-key error
 * so the user is prompted to reconnect rather than seeing a cryptic error loop.
 *
 * In OAuth mode the real credential lives in the macOS Keychain (or the
 * keychain bridge file), not the vault. The Anthropic SDK already attempts
 * an internal refresh in ClaudeCodeProvider.completeWithOAuth before the
 * error reaches us, so a 401 here means refresh already failed. Deleting
 * the vault's stale anthropic_api_key entry would do nothing useful and
 * would flip the UI to "disconnected" even though the keychain token is
 * still there — making it look like we deleted something we didn't.
 * Skip the wipe in that case.
 */
export async function clearDefaultProviderCredential(): Promise<void> {
  const providerId = await readDefaultProviderId();
  if (providerId === 'claude-code' && claudeCodeProvider?.getAuthMode() === 'oauth') {
    logger.warn(
      'Claude auth failure in OAuth mode — refresh already attempted by provider. ' +
        'Leaving vault/env untouched; user must re-login via Claude Code CLI if this persists.',
    );
    return;
  }
  await deleteProviderCredential(providerId);
  logger.warn('Default provider credential cleared due to auth failure — user must reconnect', {
    provider: providerId,
  });
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

  // Keychain check is the source of truth for Claude Code OAuth tokens on
  // macOS — without this the UI shows Claude as "disconnected" whenever the
  // vault/env ANTHROPIC_API_KEY is absent, even though the OAuth token is
  // present and usable. See ClaudeCodeProvider.initialize for the same
  // resolution order the provider itself uses at startup.
  const hasAnthropicKey =
    !!process.env.ANTHROPIC_API_KEY ||
    !!process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    (await hasVaultKey('anthropic_api_key')) ||
    (await hasVaultKey('anthropic_oauth_token')) ||
    !!(await readTokenFromKeychain());

  // Vault/env API key only — excludes keychain OAuth. Used to determine
  // whether a removable API key is stored (the API KEY section in settings).
  const hasAnthropicApiKey = !!process.env.ANTHROPIC_API_KEY || (await hasVaultKey('anthropic_api_key'));

  const hasOpenaiKey = !!process.env.OPENAI_API_KEY || (await hasVaultKey('openai_api_key'));

  return { defaultModel, defaultProvider, hasAnthropicKey, hasAnthropicApiKey, hasOpenaiKey };
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
  const mappings = PROVIDER_VAULT_KEYS[args.provider];
  if (!mappings) {
    return { success: false, error: `Unknown provider: ${args.provider}` };
  }
  // First entry is the primary (api_key) mapping used for saves.
  const primary = mappings[0];

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
    await vault.set(primary.vaultKey, apiKey);
  }

  // Set in process env so the provider picks it up
  process.env[primary.envKey] = apiKey;

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
  if (!PROVIDER_VAULT_KEYS[args.provider]) {
    return { success: false, error: `Unknown provider: ${args.provider}` };
  }
  await deleteProviderCredential(args.provider);
  return { success: true };
}
