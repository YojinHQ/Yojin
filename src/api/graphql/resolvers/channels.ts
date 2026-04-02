import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createWhatsAppSession } from '../../../../channels/whatsapp/src/session.js';
import { createSubsystemLogger } from '../../../logging/logger.js';
import type { PluginRegistry } from '../../../plugins/registry.js';
import type { SecretVault } from '../../../trust/vault/types.js';
import { pubsub } from '../pubsub.js';

const logger = createSubsystemLogger('channel-resolver');

let vault: SecretVault | undefined;
let registry: PluginRegistry | undefined;
let dataRoot: string | undefined;

export function setChannelVault(v: SecretVault): void {
  vault = v;
}

export function setChannelRegistry(r: PluginRegistry): void {
  registry = r;
}

export function setChannelDataRoot(root: string): void {
  dataRoot = root;
}

let oauthDir: string | undefined;

export function setChannelOAuthDir(dir: string): void {
  oauthDir = dir;
}

const ALL_NOTIFICATION_TYPES = ['snap.ready', 'insight.ready', 'action.created', 'approval.requested'];
/** Notification types enabled by default when user has no explicit preferences. */
const DEFAULT_ENABLED_TYPES = ['insight.ready', 'action.created', 'approval.requested'];

interface ChannelDef {
  id: string;
  name: string;
  description: string;
  requiredCredentials: string[];
  validate: (credentials: Record<string, string>) => Promise<{ valid: boolean; error?: string }>;
}

const CHANNEL_DEFS: ChannelDef[] = [
  {
    id: 'web',
    name: 'Web Dashboard',
    description: 'Built-in web interface — always available',
    requiredCredentials: [],
    validate: async () => ({ valid: true }),
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Bot notifications, approval buttons, daily briefings',
    requiredCredentials: ['TELEGRAM_BOT_TOKEN'],
    validate: async (creds) => {
      const token = creds.TELEGRAM_BOT_TOKEN;
      if (!token) return { valid: false, error: 'Bot token is required' };
      try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = (await res.json()) as { ok: boolean; description?: string };
        return data.ok ? { valid: true } : { valid: false, error: data.description ?? 'Invalid token' };
      } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : 'Connection failed' };
      }
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Workspace messaging and notifications',
    requiredCredentials: ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'],
    validate: async (creds) => {
      const token = creds.SLACK_BOT_TOKEN;
      if (!token) return { valid: false, error: 'Bot token is required' };
      try {
        const res = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        return data.ok ? { valid: true } : { valid: false, error: data.error ?? 'Invalid token' };
      } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : 'Connection failed' };
      }
    },
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Direct-to-phone alerts via WhatsApp',
    requiredCredentials: [],
    validate: async () => {
      if (!oauthDir) return { valid: false, error: 'OAuth directory not configured' };
      try {
        await access(join(oauthDir, 'whatsapp', 'creds.json'));
        return { valid: true };
      } catch {
        return { valid: false, error: 'Not paired — scan QR code to connect' };
      }
    },
  },
];

interface ChannelResult {
  success: boolean;
  error?: string;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60_000;

let failedAttempts = 0;
let lockoutUntil = 0;

function checkRateLimit(): ChannelResult | null {
  const now = Date.now();
  if (lockoutUntil > 0 && now < lockoutUntil) {
    const remainingSec = Math.ceil((lockoutUntil - now) / 1000);
    return { success: false, error: `Too many attempts. Try again in ${remainingSec}s.` };
  }
  if (lockoutUntil > 0 && now >= lockoutUntil) {
    failedAttempts = 0;
    lockoutUntil = 0;
  }
  return null;
}

function recordFailure(): void {
  failedAttempts++;
  if (failedAttempts >= MAX_ATTEMPTS) {
    lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
    failedAttempts = 0;
  }
}

function recordSuccess(): void {
  failedAttempts = 0;
  lockoutUntil = 0;
}

interface CredentialInput {
  key: string;
  value: string;
}

function findChannel(id: string): ChannelDef | undefined {
  return CHANNEL_DEFS.find((d) => d.id === id);
}

// Cached validation results with 60s TTL to avoid hitting external APIs on every listChannels query.
const VALIDATION_TTL_MS = 60_000;
const validationCache = new Map<string, { status: string; statusMessage: string | null; cachedAt: number }>();

function getCachedValidation(channelId: string): { status: string; statusMessage: string | null } | null {
  const entry = validationCache.get(channelId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > VALIDATION_TTL_MS) {
    validationCache.delete(channelId);
    return null;
  }
  return { status: entry.status, statusMessage: entry.statusMessage };
}

function setCachedValidation(channelId: string, status: string, statusMessage: string | null): void {
  validationCache.set(channelId, { status, statusMessage, cachedAt: Date.now() });
}

/** Invalidate cached validation for a channel (e.g. after connect/disconnect). */
function invalidateValidationCache(channelId: string): void {
  validationCache.delete(channelId);
}

function toCredMap(credentials: CredentialInput[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of credentials) map[c.key] = c.value;
  return map;
}

async function startChannel(id: string): Promise<string | undefined> {
  const channel = registry?.getChannel(id);
  if (!channel) return undefined;
  try {
    await channel.initialize?.({});
    return undefined;
  } catch (err) {
    return `Saved but failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function stopChannel(id: string): Promise<void> {
  const channel = registry?.getChannel(id);
  if (!channel) return;
  try {
    await channel.shutdown?.();
  } catch (err) {
    logger.error('Failed to stop channel', { channelId: id, error: err });
  }
}

export async function listChannelsQuery(): Promise<
  {
    id: string;
    name: string;
    status: string;
    statusMessage: string | null;
    description: string | null;
    requiredCredentials: string[];
  }[]
> {
  return Promise.all(
    CHANNEL_DEFS.map(async (def) => {
      let status = 'NOT_CONNECTED';
      let statusMessage: string | null = null;

      if (def.id === 'whatsapp') {
        if (oauthDir) {
          const connected = await access(join(oauthDir, 'whatsapp', 'creds.json'))
            .then(() => true)
            .catch(() => false);
          if (connected) status = 'CONNECTED';
        }
      } else if (def.requiredCredentials.length === 0) {
        status = 'CONNECTED';
      } else if (vault) {
        const v = vault;
        const checks = await Promise.all(def.requiredCredentials.map((k) => v.has(k)));
        if (checks.every(Boolean)) {
          // Use cached validation result if available (avoids hitting external APIs every query)
          const cached = getCachedValidation(def.id);
          if (cached) {
            status = cached.status;
            statusMessage = cached.statusMessage;
          } else {
            const credMap: Record<string, string> = {};
            for (const key of def.requiredCredentials) {
              const val = await v.get(key);
              if (val) credMap[key] = val;
            }
            const validation = await def.validate(credMap);
            if (validation.valid) {
              status = 'CONNECTED';
            } else {
              status = 'ERROR';
              statusMessage = validation.error ?? 'Credentials are no longer valid';
            }
            setCachedValidation(def.id, status, statusMessage);
          }
        }
      }

      return {
        id: def.id,
        name: def.name,
        status,
        statusMessage,
        description: def.description,
        requiredCredentials: def.requiredCredentials,
      };
    }),
  );
}

export async function connectChannelMutation(
  _parent: unknown,
  args: { id: string; credentials: CredentialInput[] },
): Promise<ChannelResult> {
  if (!vault) return { success: false, error: 'Vault not configured' };

  const blocked = checkRateLimit();
  if (blocked) return blocked;

  const def = findChannel(args.id);
  if (!def) return { success: false, error: `Unknown channel: ${args.id}` };

  const credMap = toCredMap(args.credentials);

  for (const key of def.requiredCredentials) {
    if (!credMap[key]) return { success: false, error: `Missing required credential: ${key}` };
  }

  const validation = await def.validate(credMap);
  if (!validation.valid) {
    recordFailure();
    return { success: false, error: validation.error ?? 'Validation failed' };
  }

  for (const c of args.credentials) await vault.set(c.key, c.value);

  const startErr = await startChannel(args.id);
  invalidateValidationCache(args.id);
  if (startErr) return { success: true, error: startErr };

  recordSuccess();
  return { success: true };
}

export async function disconnectChannelMutation(_parent: unknown, args: { id: string }): Promise<ChannelResult> {
  if (!vault) return { success: false, error: 'Vault not configured' };

  const def = findChannel(args.id);
  if (!def) return { success: false, error: `Unknown channel: ${args.id}` };
  if (def.id === 'web') return { success: false, error: 'Cannot disconnect the web channel' };

  if (def.id === 'whatsapp') {
    await cleanupPairingSession();
    await stopChannel('whatsapp');
    invalidateValidationCache('whatsapp');
    if (oauthDir) {
      await rm(join(oauthDir, 'whatsapp'), { recursive: true, force: true });
    }
    return { success: true };
  }

  await stopChannel(args.id);
  invalidateValidationCache(args.id);

  for (const key of def.requiredCredentials) {
    if (await vault.has(key)) await vault.delete(key);
  }

  return { success: true };
}

export async function validateChannelTokenMutation(
  _parent: unknown,
  args: { id: string; credentials: CredentialInput[] },
): Promise<ChannelResult> {
  const blocked = checkRateLimit();
  if (blocked) return blocked;

  const def = findChannel(args.id);
  if (!def) return { success: false, error: `Unknown channel: ${args.id}` };

  const validation = await def.validate(toCredMap(args.credentials));
  if (!validation.valid) {
    recordFailure();
    return { success: false, error: validation.error ?? 'Invalid credentials' };
  }

  recordSuccess();
  return { success: true };
}

interface NotificationPrefsFile {
  preferences: Record<string, string[]>;
}

async function loadPreferences(): Promise<Record<string, string[]>> {
  if (!dataRoot) return {};
  const filePath = join(dataRoot, 'config', 'notifications.json');
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as NotificationPrefsFile;
    return parsed.preferences ?? {};
  } catch {
    return {};
  }
}

async function savePreferences(prefs: Record<string, string[]>): Promise<void> {
  if (!dataRoot) return;
  const dir = join(dataRoot, 'config');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'notifications.json'), JSON.stringify({ preferences: prefs }, null, 2));
}

export async function isNotificationEnabled(channelId: string, notificationType: string): Promise<boolean> {
  const prefs = await loadPreferences();
  if (!(channelId in prefs)) return DEFAULT_ENABLED_TYPES.includes(notificationType);
  return prefs[channelId].includes(notificationType);
}

export async function notificationPreferencesQuery(): Promise<{ channelId: string; enabledTypes: string[] }[]> {
  const prefs = await loadPreferences();
  const results: { channelId: string; enabledTypes: string[] }[] = [];

  for (const def of CHANNEL_DEFS) {
    const enabled = prefs[def.id] ?? DEFAULT_ENABLED_TYPES;
    results.push({ channelId: def.id, enabledTypes: enabled });
  }

  return results;
}

let activePairingSession: import('../../../../channels/whatsapp/src/session.js').WhatsAppSession | undefined;
const PAIRING_TIMEOUT_MS = 120_000;
let pairingTimer: ReturnType<typeof setTimeout> | undefined;

async function cleanupPairingSession(): Promise<void> {
  if (pairingTimer) {
    clearTimeout(pairingTimer);
    pairingTimer = undefined;
  }
  if (activePairingSession) {
    const session = activePairingSession;
    activePairingSession = undefined;
    try {
      await session.disconnect();
    } catch (err) {
      logger.error('Failed to cleanup pairing session', { error: err });
    }
  }
}

export async function initiateChannelPairingMutation(
  _parent: unknown,
  args: { id: string },
): Promise<{ success: boolean; error?: string; qrData?: string }> {
  if (args.id !== 'whatsapp') {
    return { success: false, error: `Channel ${args.id} does not support QR pairing` };
  }

  if (!oauthDir) return { success: false, error: 'OAuth directory not configured' };

  await cleanupPairingSession();

  const authDir = join(oauthDir, 'whatsapp');

  try {
    const session = createWhatsAppSession({
      authDir,
      onQr: (qrData) => {
        pubsub.publish(`channelPairing:${args.id}`, {
          status: 'WAITING_FOR_SCAN',
          qrData,
        });
      },
      onConnected: () => {
        pubsub.publish(`channelPairing:${args.id}`, { status: 'CONNECTED' });
        cleanupPairingSession().then(() => {
          startChannel('whatsapp').catch((err) => {
            logger.error('Failed to start WhatsApp after pairing', { error: err });
          });
        });
      },
      onDisconnected: (reason) => {
        pubsub.publish(`channelPairing:${args.id}`, { status: 'FAILED', error: reason });
        cleanupPairingSession().catch(() => {});
      },
      onLoggedOut: () => {
        pubsub.publish(`channelPairing:${args.id}`, { status: 'FAILED', error: 'Logged out' });
        cleanupPairingSession().catch(() => {});
      },
    });

    activePairingSession = session;

    pairingTimer = setTimeout(() => {
      if (activePairingSession === session) {
        logger.warn('Pairing timed out after 2 minutes');
        pubsub.publish(`channelPairing:${args.id}`, { status: 'EXPIRED', error: 'Pairing timed out' });
        cleanupPairingSession().catch(() => {});
      }
    }, PAIRING_TIMEOUT_MS);

    await session.connect();
    return { success: true };
  } catch (e) {
    logger.error('Failed to initiate WhatsApp pairing', { error: e });
    await cleanupPairingSession();
    return { success: false, error: 'Failed to initiate pairing — check server logs' };
  }
}

export async function cancelChannelPairingMutation(
  _parent: unknown,
  args: { id: string },
): Promise<{ success: boolean }> {
  if (args.id !== 'whatsapp') {
    return { success: false };
  }
  await cleanupPairingSession();
  return { success: true };
}

const QR_PAIRING_CHANNELS = new Set(['whatsapp']);

export const onChannelPairingSubscription = {
  subscribe: (_parent: unknown, args: { id: string }) => {
    if (!QR_PAIRING_CHANNELS.has(args.id)) {
      throw new Error(`Channel ${args.id} does not support QR pairing`);
    }
    return pubsub.subscribe(`channelPairing:${args.id}`);
  },
  resolve: (payload: unknown) => payload,
};

export async function saveNotificationPreferencesMutation(
  _parent: unknown,
  args: { channelId: string; enabledTypes: string[] },
): Promise<boolean> {
  const def = findChannel(args.channelId);
  if (!def) return false;

  const validTypes = args.enabledTypes.filter((t) => ALL_NOTIFICATION_TYPES.includes(t));
  const prefs = await loadPreferences();
  prefs[args.channelId] = validTypes;
  await savePreferences(prefs);
  return true;
}
