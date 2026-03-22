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

import { buildClaudeOAuthUrl, exchangeClaudeOAuthCode, generatePkceParams } from '../../../auth/claude-oauth.js';
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
let dataRoot = '.';

// Pending OAuth flows (state → PKCE params)
const pendingOAuth = new Map<string, { codeVerifier: string; codeChallenge: string }>();

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

export function setOnboardingConnectionManager(cm: ConnectionManager): void {
  connectionManager = cm;
}

export function setOnboardingSnapshotStore(store: PortfolioSnapshotStore): void {
  snapshotStore = store;
}

export function setOnboardingDataRoot(root: string): void {
  dataRoot = root;
}

// ---------------------------------------------------------------------------
// Query resolvers
// ---------------------------------------------------------------------------

interface DetectedCredential {
  method: 'OAUTH' | 'API_KEY' | 'ENV_DETECTED';
  model?: string;
}

export async function detectAiCredentialQuery(): Promise<DetectedCredential | null> {
  // Check environment variables
  if (process.env.ANTHROPIC_API_KEY) {
    return { method: 'ENV_DETECTED', model: 'Claude (env key)' };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { method: 'ENV_DETECTED', model: 'Claude via OpenRouter (env key)' };
  }

  // Check vault
  if (vault?.isUnlocked) {
    if (await vault.has('anthropic_api_key')) {
      return { method: 'ENV_DETECTED', model: 'Claude (vault)' };
    }
    if (await vault.has('openrouter_api_key')) {
      return { method: 'ENV_DETECTED', model: 'Claude via OpenRouter (vault)' };
    }
  }

  return null;
}

interface OnboardingStatusResult {
  personaExists: boolean;
  aiCredentialConfigured: boolean;
  connectedPlatforms: string[];
  briefingConfigured: boolean;
}

export async function onboardingStatusQuery(): Promise<OnboardingStatusResult> {
  const personaExists = personaManager ? !personaManager.isFirstRun() : false;

  let aiCredentialConfigured = !!process.env.ANTHROPIC_API_KEY;
  if (!aiCredentialConfigured && vault?.isUnlocked) {
    aiCredentialConfigured = await vault.has('anthropic_api_key');
  }

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

  return { personaExists, aiCredentialConfigured, connectedPlatforms, briefingConfigured };
}

// ---------------------------------------------------------------------------
// Mutation resolvers
// ---------------------------------------------------------------------------

interface ValidateCredentialInput {
  method: 'OAUTH' | 'API_KEY' | 'ENV_DETECTED';
  apiKey?: string;
  provider?: 'ANTHROPIC' | 'OPENROUTER';
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
    return { success: true, model: 'Claude (Anthropic)' };
  }

  const body = await res.json().catch(() => ({}));
  const errorMsg = (body as Record<string, unknown>)?.error
    ? String((body as Record<string, Record<string, unknown>>).error?.message || 'Invalid API key')
    : `API returned ${res.status}`;
  return { success: false, error: errorMsg };
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

interface OAuthInitResult {
  authUrl: string;
  state: string;
}

export function initiateOAuthMutation(): OAuthInitResult {
  const { codeVerifier, codeChallenge, state } = generatePkceParams();
  const authUrl = buildClaudeOAuthUrl({ codeChallenge, state });

  // Store PKCE params for the callback exchange
  pendingOAuth.set(state, { codeVerifier, codeChallenge });

  // Clean up stale entries after 10 minutes
  setTimeout(() => pendingOAuth.delete(state), 10 * 60 * 1000);

  return { authUrl, state };
}

export async function exchangeOAuthCodeMutation(
  _parent: unknown,
  args: { code: string; state: string },
): Promise<ValidateCredentialResult> {
  const pending = pendingOAuth.get(args.state);
  if (!pending) {
    return { success: false, error: 'OAuth session expired or invalid. Please try again.' };
  }

  try {
    const result = await exchangeClaudeOAuthCode({
      code: args.code,
      codeVerifier: pending.codeVerifier,
      state: args.state,
    });

    pendingOAuth.delete(args.state);

    // Store the access token in the vault
    if (vault?.isUnlocked && result.accessToken) {
      await vault.set('anthropic_oauth_token', result.accessToken);
      if (result.refreshToken) {
        await vault.set('anthropic_oauth_refresh_token', result.refreshToken);
      }
    }

    return { success: true, model: 'Claude (OAuth)' };
  } catch (err) {
    pendingOAuth.delete(args.state);
    return { success: false, error: err instanceof Error ? err.message : 'OAuth code exchange failed' };
  }
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

  const prompt = `Generate a concise persona profile in Markdown for a personal AI finance agent's "Strategist" personality.

The user provided these preferences:
- Name: ${name || 'not provided'}
- Risk tolerance: ${riskTolerance.toLowerCase() || 'moderate'}
- Asset classes: ${assetClasses.join(', ') || 'stocks and crypto'}
- Communication style: ${communicationStyle.toLowerCase() || 'concise'}
- Hard rules: ${hardRules || 'none specified'}

Generate a Markdown document with:
1. A "# Persona:" title line with a short descriptive name
2. 4-6 bullet-style personality/behavior rules (first person "I")
3. A "## Communication Style" section with 3-5 style rules
${hardRules ? '4. A "## Hard Rules" section with the user\'s constraints' : ''}

Keep it under 20 lines. Be specific and actionable, not generic. Use the user's name if provided.
Output ONLY the Markdown — no code fences, no preamble.`;

  const response = await provider.completeWithTools({
    model: providerModel,
    system: 'You are a helpful assistant that generates persona profiles. Output only Markdown, no code fences.',
    messages: [{ role: 'user', content: prompt }],
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
    const snapshotPositions = positions.map((p) => ({
      symbol: p.symbol,
      name: p.name || p.symbol,
      quantity: p.quantity || 0,
      costBasis: p.avgEntry || 0,
      currentPrice: p.marketValue && p.quantity ? p.marketValue / p.quantity : p.avgEntry || 0,
      marketValue: p.marketValue || 0,
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      assetClass: 'EQUITY' as const,
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
  const [hours, minutes] = time.split(':').map(Number);
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}
