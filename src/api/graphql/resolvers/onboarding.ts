/**
 * Onboarding resolvers — credential detection/validation, persona generation,
 * screenshot parsing, position confirmation, and briefing config.
 *
 * Module-level state pattern: setter functions called once during server startup
 * to inject services from the composition root.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ClaudeCodeProvider } from '../../../ai-providers/claude-code.js';
import {
  buildClaudeOAuthUrl,
  exchangeClaudeOAuthCode,
  generatePkceParams,
  refreshClaudeOAuthToken,
} from '../../../auth/claude-oauth.js';
import { readRefreshTokenFromKeychain, readTokenFromKeychain } from '../../../auth/keychain.js';
import { completeMagicLinkFlow, startMagicLinkFlow } from '../../../auth/magic-link-flow.js';
import type { PersonaManager } from '../../../brain/types.js';
import type { AgentLoopProvider } from '../../../core/types.js';
import type { PortfolioSnapshotStore } from '../../../portfolio/snapshot-store.js';
import type { ConnectionManager } from '../../../scraper/connection-manager.js';
import type { EncryptedVault } from '../../../trust/vault/vault.js';

// ---------------------------------------------------------------------------
// Module-level state (injected via setters)
// ---------------------------------------------------------------------------

let vault: EncryptedVault | undefined;
let personaManager: PersonaManager | undefined;
let provider: AgentLoopProvider | undefined;
let providerModel = 'claude-sonnet-4-20250514';
let connectionManager: ConnectionManager | undefined;
let snapshotStore: PortfolioSnapshotStore | undefined;
let claudeCodeProvider: ClaudeCodeProvider | undefined;
let dataRoot = '.';
let onJintelKeyValidatedCb: ((apiKey: string) => void) | undefined;

export function setOnboardingVault(v: EncryptedVault): void {
  vault = v;
}

export function setOnboardingPersonaManager(pm: PersonaManager): void {
  personaManager = pm;
}

export function setOnboardingProvider(p: AgentLoopProvider, model?: string): void {
  provider = p;
  if (model) providerModel = model;
}

export function setOnboardingClaudeCodeProvider(ccp: ClaudeCodeProvider): void {
  claudeCodeProvider = ccp;
}

export function setOnboardingConnectionManager(cm: ConnectionManager): void {
  connectionManager = cm;
}

export function setOnboardingSnapshotStore(store: PortfolioSnapshotStore): void {
  snapshotStore = store;
}

export function setOnboardingDataRoot(root: string): void {
  dataRoot = root;
}

export function setJintelKeyValidatedCallback(cb: (apiKey: string) => void): void {
  onJintelKeyValidatedCb = cb;
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

interface DetectedCredential {
  method: 'MAGIC_LINK' | 'API_KEY' | 'ENV_DETECTED';
  model?: string;
}

export async function detectAiCredentialQuery(): Promise<DetectedCredential | null> {
  // Check environment variables
  if (process.env.ANTHROPIC_API_KEY) {
    return { method: 'ENV_DETECTED', model: 'Claude (env key)' };
  }
  if (process.env.OPENAI_API_KEY) {
    return { method: 'ENV_DETECTED', model: 'OpenAI (env key)' };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { method: 'ENV_DETECTED', model: 'Claude via OpenRouter (env key)' };
  }

  // Check vault
  if (vault?.isUnlocked) {
    if (await vault.has('anthropic_api_key')) {
      return { method: 'ENV_DETECTED', model: 'Claude (vault)' };
    }
    if (await vault.has('openai_api_key')) {
      return { method: 'ENV_DETECTED', model: 'OpenAI (vault)' };
    }
    if (await vault.has('openrouter_api_key')) {
      return { method: 'ENV_DETECTED', model: 'Claude via OpenRouter (vault)' };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Keychain detection
// ---------------------------------------------------------------------------

interface KeychainTokenResult {
  found: boolean;
  model?: string;
  error?: string;
}

/**
 * Store an OAuth token in the vault, set it in the env, and reconfigure the
 * ClaudeCodeProvider so subsequent API calls use it immediately.
 */
async function activateOAuthToken(token: string): Promise<void> {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
  if (vault?.isUnlocked) {
    await vault.set('anthropic_oauth_token', token);
  }
  claudeCodeProvider?.configureOAuthToken(token);
}

/**
 * Validate an OAuth token with a lightweight API call.
 */
async function validateOAuthToken(token: string): Promise<boolean> {
  // Use claude-3-haiku for validation — lightweight and available on all OAuth plans
  // (newer models like claude-sonnet-4 may return 400 on Max/subscription OAuth tokens)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check macOS Keychain for an existing Claude Code OAuth token.
 * If found, validate it (refreshing if expired) and store in vault.
 */
export async function detectKeychainTokenQuery(): Promise<KeychainTokenResult> {
  const token = await readTokenFromKeychain();
  if (!token) {
    return { found: false };
  }

  // Try the token as-is first
  if (await validateOAuthToken(token)) {
    activateOAuthToken(token);
    return { found: true, model: 'Claude (Keychain)' };
  }

  // Token expired/invalid — try refreshing
  const refreshToken = await readRefreshTokenFromKeychain();
  if (refreshToken) {
    try {
      const refreshed = await refreshClaudeOAuthToken(refreshToken);
      if (await validateOAuthToken(refreshed.accessToken)) {
        activateOAuthToken(refreshed.accessToken);
        if (vault?.isUnlocked && refreshed.refreshToken) {
          await vault.set('anthropic_oauth_refresh_token', refreshed.refreshToken);
        }
        return { found: true, model: 'Claude (Keychain)' };
      }
    } catch {
      // Refresh failed — token is truly expired
    }
  }

  return {
    found: true,
    error: 'Keychain token found but expired. Re-authenticate Claude Code with: claude auth login',
  };
}

// ---------------------------------------------------------------------------
// OAuth PKCE flow
// ---------------------------------------------------------------------------

/** In-memory PKCE state keyed by `state` param to handle concurrent/double-click flows. */
const PKCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface PkceEntry {
  codeVerifier: string;
  createdAt: number;
}

const pendingPkceByState = new Map<string, PkceEntry>();

interface OAuthFlowResult {
  authUrl: string;
  state: string;
}

/**
 * Generate PKCE parameters and return the Claude OAuth authorization URL.
 * The frontend opens this URL in the user's browser.
 */
export function startOAuthFlowMutation(): OAuthFlowResult {
  // Prune expired PKCE entries from abandoned flows
  const now = Date.now();
  for (const [k, v] of pendingPkceByState) {
    if (now - v.createdAt > PKCE_TTL_MS) pendingPkceByState.delete(k);
  }

  const pkce = generatePkceParams();
  pendingPkceByState.set(pkce.state, { codeVerifier: pkce.codeVerifier, createdAt: now });

  const authUrl = buildClaudeOAuthUrl({
    codeChallenge: pkce.codeChallenge,
    state: pkce.state,
  });

  return { authUrl, state: pkce.state };
}

interface OAuthCompleteResult {
  success: boolean;
  model?: string;
  error?: string;
}

/**
 * Exchange the authorization code from the OAuth redirect for an access token.
 * The user copies the code from the redirect page and pastes it here.
 */
export async function completeOAuthFlowMutation(
  _parent: unknown,
  args: { code: string; state: string },
): Promise<OAuthCompleteResult> {
  const code = args.code.trim();
  if (!code) {
    return { success: false, error: 'Authorization code is required.' };
  }

  const state = args.state.trim();
  const entry = pendingPkceByState.get(state);
  if (!entry) {
    return { success: false, error: 'No pending OAuth flow. Please start again.' };
  }

  try {
    const result = await exchangeClaudeOAuthCode({
      code,
      codeVerifier: entry.codeVerifier,
      state,
    });

    // Clear the used PKCE entry
    pendingPkceByState.delete(state);

    // Store, set env, and reconfigure provider so the token is usable immediately
    await activateOAuthToken(result.accessToken);
    if (vault?.isUnlocked && result.refreshToken) {
      await vault.set('anthropic_oauth_refresh_token', result.refreshToken);
    }
    if (result.refreshToken) {
      process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN = result.refreshToken;
    }

    return { success: true, model: 'Claude (OAuth)' };
  } catch (err) {
    pendingPkceByState.delete(state);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'OAuth token exchange failed.',
    };
  }
}

interface OnboardingStatusResult {
  completed: boolean;
  personaExists: boolean;
  aiCredentialConfigured: boolean;
  connectedPlatforms: string[];
  briefingConfigured: boolean;
  jintelConfigured: boolean;
}

/** Path to the persistent onboarding completion marker. */
function onboardingCompletedPath(): string {
  return `${dataRoot}/config/onboarding-completed.json`;
}

export async function onboardingStatusQuery(): Promise<OnboardingStatusResult> {
  const completed = existsSync(onboardingCompletedPath());

  const personaExists = personaManager ? !personaManager.isFirstRun() : false;

  const detected = await detectAiCredentialQuery();
  const aiCredentialConfigured = detected !== null;

  let connectedPlatforms: string[] = [];
  if (connectionManager) {
    try {
      const connections = await connectionManager.listConnections();
      connectedPlatforms = connections.filter((c) => c.status === 'CONNECTED').map((c) => c.platform);
    } catch {
      // ConnectionManager not ready
    }
  }

  const alertsConfigPath = `${dataRoot}/config/alerts.json`;
  const briefingConfigured = existsSync(alertsConfigPath);

  const jintelConfigured = vault?.isUnlocked ? !!(await vault.get('jintel-api-key')) : false;

  return { completed, personaExists, aiCredentialConfigured, connectedPlatforms, briefingConfigured, jintelConfigured };
}

/** Mark onboarding as completed (called at the end of the flow). */
export async function completeOnboardingMutation(): Promise<boolean> {
  const filePath = onboardingCompletedPath();
  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify({ completedAt: new Date().toISOString() }), 'utf-8');
  return true;
}

// ---------------------------------------------------------------------------
// Jintel key validation
// ---------------------------------------------------------------------------

export async function validateJintelKeyMutation(
  _parent: unknown,
  args: { apiKey: string },
): Promise<{ success: boolean; error?: string }> {
  const apiKey = args.apiKey.trim();

  if (!apiKey) {
    return { success: false, error: 'API key cannot be empty.' };
  }

  // Fail fast if vault can't store the key — before making any network call
  if (!vault?.isUnlocked) {
    return { success: false, error: 'Vault is locked. Unlock it first.' };
  }

  // Create a temporary client to test the key
  const { JintelClient } = await import('../../../jintel/client.js');
  const baseUrl = process.env.JINTEL_API_URL ?? 'https://api.jintel.ai/api';
  const testClient = new JintelClient({ baseUrl, apiKey });
  const health = await testClient.healthCheck();

  if (!health.healthy) {
    return { success: false, error: health.error ?? 'Failed to connect to Jintel API.' };
  }

  try {
    await vault.set('jintel-api-key', apiKey);
    onJintelKeyValidatedCb?.(apiKey);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to store key: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

interface ValidateCredentialInput {
  method: 'MAGIC_LINK' | 'API_KEY' | 'ENV_DETECTED';
  apiKey?: string;
  provider?: 'ANTHROPIC' | 'OPENAI' | 'OPENROUTER';
}

interface ValidateCredentialResult {
  success: boolean;
  model?: string;
  error?: string;
}

async function validateAnthropicKey(apiKey: string): Promise<ValidateCredentialResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });

  if (res.ok) {
    if (vault?.isUnlocked) {
      await vault.set('anthropic_api_key', apiKey);
    }
    process.env.ANTHROPIC_API_KEY = apiKey;
    claudeCodeProvider?.configureApiKey(apiKey);
    return { success: true, model: 'Claude (Anthropic)' };
  }

  const body = await res.json().catch(() => ({}));
  const errorMsg = (body as Record<string, unknown>)?.error
    ? String((body as Record<string, Record<string, unknown>>).error?.message || 'Invalid API key')
    : `API returned ${res.status}`;
  return { success: false, error: errorMsg };
}

async function validateOpenAiKey(apiKey: string): Promise<ValidateCredentialResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });

  if (res.ok) {
    if (vault?.isUnlocked) {
      await vault.set('openai_api_key', apiKey);
    }
    return { success: true, model: 'OpenAI' };
  }

  const body = await res.json().catch(() => ({}));
  const errorMsg = (body as Record<string, Record<string, unknown>>)?.error?.message;
  return { success: false, error: errorMsg ? String(errorMsg) : 'Invalid OpenAI API key' };
}

async function validateOpenRouterKey(apiKey: string): Promise<ValidateCredentialResult> {
  // Validate by making a minimal chat completion with a tiny model
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-4',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  });

  if (res.ok) {
    if (vault?.isUnlocked) {
      await vault.set('openrouter_api_key', apiKey);
    }
    return { success: true, model: 'Claude via OpenRouter' };
  }

  const body = await res.json().catch(() => ({}));
  const errorMsg = (body as Record<string, Record<string, unknown>>)?.error?.message;
  return { success: false, error: errorMsg ? String(errorMsg) : 'Invalid OpenRouter API key' };
}

export async function validateAiCredentialMutation(
  _parent: unknown,
  args: { input: ValidateCredentialInput },
): Promise<ValidateCredentialResult> {
  const { method, apiKey, provider: keyProvider } = args.input;

  if (method === 'API_KEY') {
    if (!apiKey?.trim()) {
      return { success: false, error: 'API key is required' };
    }

    try {
      if (keyProvider === 'OPENROUTER') {
        return await validateOpenRouterKey(apiKey.trim());
      }
      if (keyProvider === 'OPENAI') {
        return await validateOpenAiKey(apiKey.trim());
      }
      return await validateAnthropicKey(apiKey.trim());
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
    }
  }

  if (method === 'ENV_DETECTED') {
    const detected = await detectAiCredentialQuery();
    if (detected) {
      return { success: true, model: detected.model };
    }
    return { success: false, error: 'No credential found in environment or vault' };
  }

  return { success: false, error: 'Unsupported method' };
}

interface MagicLinkResult {
  success: boolean;
  error?: string;
}

interface MagicLinkVerifyResult {
  success: boolean;
  model?: string;
  error?: string;
}

/**
 * Launch a headless browser, navigate to Claude's OAuth page, and enter the
 * user's email. Claude will send a magic-link email to that address.
 */
export async function sendMagicLinkMutation(_parent: unknown, args: { email: string }): Promise<MagicLinkResult> {
  const email = args.email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { success: false, error: 'Please enter a valid email address.' };
  }

  return startMagicLinkFlow(email);
}

/**
 * Navigate the existing headless browser to the magic-link URL the user
 * received from Anthropic. The browser clicks through the authorize flow,
 * captures the OAuth callback, and exchanges the code for an access token.
 */
export async function completeMagicLinkMutation(
  _parent: unknown,
  args: { magicLinkUrl: string },
): Promise<MagicLinkVerifyResult> {
  const url = args.magicLinkUrl.trim();
  if (!url) {
    return { success: false, error: 'Magic link URL is required.' };
  }

  const result = await completeMagicLinkFlow(url);

  if (result.success && result.token) {
    // Store, set env, and reconfigure provider so the token is usable immediately
    await activateOAuthToken(result.token);
    // Store refresh token for auto-refresh (same as regular OAuth flow)
    if (result.refreshToken) {
      if (vault?.isUnlocked) {
        await vault.set('anthropic_oauth_refresh_token', result.refreshToken);
      }
      process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN = result.refreshToken;
    }
    return { success: true, model: result.model || 'Claude (OAuth)' };
  }

  return { success: false, error: result.error || 'Failed to complete OAuth flow.' };
}

interface PersonaInput {
  name: string;
  riskTolerance: string;
  assetClasses: string[];
  communicationStyle: string;
  hardRules?: string;
}

interface PersonaResult {
  markdown: string;
}

export async function generatePersonaMutation(_parent: unknown, args: { input: PersonaInput }): Promise<PersonaResult> {
  if (!provider) {
    throw new Error('AI provider not configured');
  }

  const { name, riskTolerance, assetClasses, communicationStyle, hardRules } = args.input;

  const prompt = `User: ${name || 'user'} | risk: ${riskTolerance.toLowerCase()} | assets: ${assetClasses.join(', ')} | style: ${communicationStyle.toLowerCase()}${hardRules ? ` | rules: ${hardRules}` : ''}

Fill this exact template (replace [...] only, keep structure identical):

# Persona: [2-3 word name]
[one-sentence investing philosophy, max 15 words]
[one-sentence risk rule, max 15 words]${hardRules ? '\n[one-sentence hard rule, max 15 words]' : ''}

## Style
- [communication rule 1, max 12 words]
- [communication rule 2, max 12 words]`;

  const response = await provider.completeWithTools({
    model: providerModel,
    system:
      'Fill the template exactly. No extra lines, no explanations, no bullets beyond what the template shows. Max 8 lines of output.',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 150,
  });

  const markdown =
    response.content
      .filter((b) => b.type === 'text')
      .map((b) => ('text' in b ? b.text : ''))
      .join('') || '';

  if (!markdown.trim()) {
    throw new Error('Failed to generate persona');
  }

  return { markdown: markdown.trim() };
}

export async function confirmPersonaMutation(_parent: unknown, args: { markdown: string }): Promise<boolean> {
  if (!personaManager) {
    throw new Error('PersonaManager not configured');
  }

  await personaManager.setPersona(args.markdown.trim() + '\n');
  return true;
}

interface ScreenshotInput {
  image: string; // base64
  mediaType: string;
  platform: string;
}

interface ScreenshotResult {
  success: boolean;
  positions?: Array<{
    symbol: string;
    name?: string;
    quantity?: number;
    avgEntry?: number;
    marketValue?: number;
  }>;
  confidence?: number;
  warnings?: string[];
  error?: string;
}

export async function parsePortfolioScreenshotMutation(
  _parent: unknown,
  args: { input: ScreenshotInput },
): Promise<ScreenshotResult> {
  if (!provider) {
    return { success: false, error: 'AI provider not configured' };
  }

  const { image, mediaType, platform } = args.input;

  try {
    // Dynamic import to avoid circular deps
    const { parsePortfolioScreenshot } = await import('../../../scraper/screenshot-parser.js');

    const imageBuffer = Buffer.from(image, 'base64');
    const result = await parsePortfolioScreenshot({
      imageData: imageBuffer,
      mediaType: mediaType as 'image/png' | 'image/jpeg' | 'image/webp',
      provider,
      model: providerModel,
      platformHint: platform,
    });

    if (result.success) {
      return {
        success: true,
        positions: result.positions.map((p) => ({
          symbol: p.symbol,
          name: p.name,
          quantity: p.quantity,
          avgEntry: p.costBasis,
          marketValue: p.marketValue,
        })),
        confidence: result.metadata.confidence,
        warnings: result.metadata.warnings,
      };
    }

    return { success: false, error: result.error };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Screenshot parsing failed' };
  }
}

interface ConfirmPositionsInput {
  platform: string;
  positions: Array<{
    symbol: string;
    name?: string;
    quantity?: number;
    avgEntry?: number;
    marketValue?: number;
  }>;
}

export async function confirmPositionsMutation(
  _parent: unknown,
  args: { input: ConfirmPositionsInput },
): Promise<boolean> {
  const { platform, positions } = args.input;

  if (snapshotStore) {
    const CRYPTO_PLATFORMS = new Set(['binance', 'coinbase', 'metamask', 'phantom', 'polymarket']);
    const inferredClass = CRYPTO_PLATFORMS.has(platform.toLowerCase()) ? 'CRYPTO' : 'EQUITY';

    const snapshotPositions = positions.map((p) => ({
      symbol: p.symbol,
      name: p.name || p.symbol,
      quantity: p.quantity || 0,
      costBasis: p.avgEntry || 0,
      currentPrice: p.quantity && p.quantity > 0 ? (p.marketValue ?? 0) / p.quantity : (p.avgEntry ?? 0),
      marketValue: p.marketValue || 0,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      assetClass: inferredClass as 'EQUITY' | 'CRYPTO',
      platform,
    }));

    await snapshotStore.save({ positions: snapshotPositions, platform });
  }

  return true;
}

interface BriefingConfigInput {
  time: string;
  timezone: string;
  sections: string[];
  channel: string;
}

export async function saveBriefingConfigMutation(
  _parent: unknown,
  args: { input: BriefingConfigInput },
): Promise<boolean> {
  const { time, timezone, sections, channel } = args.input;

  // Write digest config to alerts.json
  const alertsPath = `${dataRoot}/config/alerts.json`;
  await ensureDir(dirname(alertsPath));

  let alertsConfig: Record<string, unknown> = {};
  try {
    if (existsSync(alertsPath)) {
      alertsConfig = JSON.parse(await readFile(alertsPath, 'utf-8'));
    }
  } catch {
    // Start fresh
  }

  // Convert time + timezone to a cron-like schedule
  const timeParts = time.split(':');
  if (timeParts.length !== 2) {
    throw new Error(`Invalid time format: "${time}". Expected HH:MM.`);
  }
  const [hours, minutes] = timeParts.map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time value: "${time}". Hours must be 0-23 and minutes 0-59.`);
  }
  alertsConfig.digestSchedule = {
    time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
    timezone,
    cron: `${minutes} ${hours} * * *`,
  };
  alertsConfig.digestSections = sections;

  await writeFile(alertsPath, JSON.stringify(alertsConfig, null, 2), 'utf-8');

  // Write channel preference to yojin.json
  const yojinPath = `${dataRoot}/config/yojin.json`;
  let yojinConfig: Record<string, unknown> = {};
  try {
    if (existsSync(yojinPath)) {
      yojinConfig = JSON.parse(await readFile(yojinPath, 'utf-8'));
    }
  } catch {
    // Start fresh
  }

  yojinConfig.briefingChannel = channel;
  await writeFile(yojinPath, JSON.stringify(yojinConfig, null, 2), 'utf-8');

  return true;
}

export async function resetOnboardingMutation(): Promise<boolean> {
  const { unlink } = await import('node:fs/promises');

  // Remove onboarding completion marker
  const markerPath = onboardingCompletedPath();
  if (existsSync(markerPath)) {
    await unlink(markerPath);
  }

  // Reset persona to default
  if (personaManager) {
    await personaManager.resetPersona();
  }

  // Remove AI + Jintel credentials from vault
  if (vault?.isUnlocked) {
    for (const key of [
      'anthropic_api_key',
      'openai_api_key',
      'openrouter_api_key',
      'anthropic_verified_email',
      'anthropic_oauth_token',
      'anthropic_oauth_refresh_token',
      'jintel-api-key',
    ]) {
      if (await vault.has(key)) {
        await vault.delete(key);
      }
    }
  }

  // Remove briefing config
  const alertsPath = `${dataRoot}/config/alerts.json`;
  if (existsSync(alertsPath)) {
    await unlink(alertsPath);
  }

  // Remove briefing channel from yojin.json
  const yojinPath = `${dataRoot}/config/yojin.json`;
  if (existsSync(yojinPath)) {
    try {
      const raw = JSON.parse(await readFile(yojinPath, 'utf-8'));
      delete raw.briefingChannel;
      await writeFile(yojinPath, JSON.stringify(raw, null, 2), 'utf-8');
    } catch {
      // Config unreadable — skip
    }
  }

  // Disconnect all platforms
  if (connectionManager) {
    try {
      const connections = await connectionManager.listConnections();
      for (const conn of connections) {
        await connectionManager.disconnectPlatform(conn.platform, { removeCredentials: true });
      }
    } catch {
      // ConnectionManager not ready
    }
  }

  // Clear portfolio snapshots from previous onboarding
  if (snapshotStore) {
    try {
      await snapshotStore.clearAll();
    } catch {
      // best-effort
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}
