import type { SecretVault } from '../../../trust/vault/types.js';

let vault: SecretVault | undefined;

export function setChannelVault(v: SecretVault): void {
  vault = v;
}

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

  const def = findChannel(args.id);
  if (!def) return { success: false, error: `Unknown channel: ${args.id}` };

  const credMap = toCredMap(args.credentials);

  for (const key of def.requiredCredentials) {
    if (!credMap[key]) return { success: false, error: `Missing required credential: ${key}` };
  }

  const validation = await def.validate(credMap);
  if (!validation.valid) return { success: false, error: validation.error ?? 'Validation failed' };

  for (const c of args.credentials) await vault.set(c.key, c.value);

  return { success: true };
}

export async function disconnectChannelMutation(_parent: unknown, args: { id: string }): Promise<ChannelResult> {
  if (!vault) return { success: false, error: 'Vault not configured' };

  const def = findChannel(args.id);
  if (!def) return { success: false, error: `Unknown channel: ${args.id}` };
  if (def.id === 'web') return { success: false, error: 'Cannot disconnect the web channel' };

  for (const key of def.requiredCredentials) {
    if (await vault.has(key)) await vault.delete(key);
  }

  return { success: true };
}

export async function validateChannelTokenMutation(
  _parent: unknown,
  args: { id: string; credentials: CredentialInput[] },
): Promise<ChannelResult> {
  const def = findChannel(args.id);
  if (!def) return { success: false, error: `Unknown channel: ${args.id}` };

  const validation = await def.validate(toCredMap(args.credentials));
  if (!validation.valid) return { success: false, error: validation.error ?? 'Invalid credentials' };

  return { success: true };
}
