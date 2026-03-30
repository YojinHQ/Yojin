import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createSubsystemLogger } from '../../../logging/logger.js';
import type { PluginRegistry } from '../../../plugins/registry.js';
import type { SecretVault } from '../../../trust/vault/types.js';

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

const ALL_NOTIFICATION_TYPES = ['snap.ready', 'insight.ready', 'action.created', 'approval.requested'];

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
  { id: string; name: string; status: string; description: string | null; requiredCredentials: string[] }[]
> {
  return Promise.all(
    CHANNEL_DEFS.map(async (def) => {
      let status = 'NOT_CONNECTED';
      if (def.requiredCredentials.length === 0) {
        status = 'CONNECTED';
      } else if (vault) {
        const v = vault;
        const checks = await Promise.all(def.requiredCredentials.map((k) => v.has(k)));
        if (checks.every(Boolean)) status = 'CONNECTED';
      }
      return {
        id: def.id,
        name: def.name,
        status,
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
  if (startErr) return { success: true, error: startErr };

  recordSuccess();
  return { success: true };
}

export async function disconnectChannelMutation(_parent: unknown, args: { id: string }): Promise<ChannelResult> {
  if (!vault) return { success: false, error: 'Vault not configured' };

  const def = findChannel(args.id);
  if (!def) return { success: false, error: `Unknown channel: ${args.id}` };
  if (def.id === 'web') return { success: false, error: 'Cannot disconnect the web channel' };

  await stopChannel(args.id);

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
  if (!(channelId in prefs)) return true; // default: all enabled
  return prefs[channelId].includes(notificationType);
}

export async function notificationPreferencesQuery(): Promise<{ channelId: string; enabledTypes: string[] }[]> {
  const prefs = await loadPreferences();
  const results: { channelId: string; enabledTypes: string[] }[] = [];

  for (const def of CHANNEL_DEFS) {
    const enabled = prefs[def.id] ?? ALL_NOTIFICATION_TYPES;
    results.push({ channelId: def.id, enabledTypes: enabled });
  }

  return results;
}

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
