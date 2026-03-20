/**
 * Platform credential requirements — which credentials each tier needs per platform.
 *
 * Hardcoded defaults for known platforms, overridable via
 * data/config/platform-credentials.json (config wins on conflict).
 */

import { readFile } from 'node:fs/promises';

import type { IntegrationTier } from './types.js';

export type CredentialLookup = (platform: string, tier: IntegrationTier) => string[];

type CredentialMap = Record<string, Partial<Record<IntegrationTier, string[]>>>;

const DEFAULT_PLATFORM_CREDENTIALS: CredentialMap = {
  COINBASE: {
    CLI: ['COINBASE_CLI_CONFIG_PATH'],
    API: ['COINBASE_API_KEY', 'COINBASE_API_SECRET'],
    UI: [],
    SCREENSHOT: [],
  },
  INTERACTIVE_BROKERS: {
    CLI: [],
    API: ['IBKR_GATEWAY_PORT'],
    UI: [],
    SCREENSHOT: [],
  },
  ROBINHOOD: {
    API: ['ROBINHOOD_API_TOKEN'],
    UI: [],
    SCREENSHOT: [],
  },
  SCHWAB: {
    API: ['SCHWAB_API_KEY', 'SCHWAB_API_SECRET'],
    UI: [],
    SCREENSHOT: [],
  },
  BINANCE: {
    API: ['BINANCE_API_KEY', 'BINANCE_API_SECRET'],
    UI: [],
    SCREENSHOT: [],
  },
  FIDELITY: {
    UI: [],
    SCREENSHOT: [],
  },
  POLYMARKET: {
    API: ['POLYMARKET_API_KEY'],
    SCREENSHOT: [],
  },
  PHANTOM: {
    API: ['PHANTOM_WALLET_ADDRESS'],
    SCREENSHOT: [],
  },
  MANUAL: {
    SCREENSHOT: [],
  },
};

export function getCredentialRequirements(platform: string, tier: IntegrationTier): string[] {
  return DEFAULT_PLATFORM_CREDENTIALS[platform]?.[tier] ?? [];
}

export function mergeCredentialOverrides(
  overrides: Record<string, Partial<Record<string, string[]>>>,
): CredentialLookup {
  return (platform: string, tier: IntegrationTier): string[] => {
    const overrideTiers = overrides[platform];
    if (overrideTiers && tier in overrideTiers) {
      return overrideTiers[tier] ?? [];
    }
    return getCredentialRequirements(platform, tier);
  };
}

/**
 * Load credential requirements with optional config overrides.
 * Reads data/config/platform-credentials.json if it exists.
 */
export async function loadCredentialLookup(configPath: string): Promise<CredentialLookup> {
  try {
    const raw = await readFile(configPath, 'utf-8');
    const overrides = JSON.parse(raw) as Record<string, Partial<Record<string, string[]>>>;
    if (Object.keys(overrides).length > 0) {
      return mergeCredentialOverrides(overrides);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(
        `Failed to parse platform credentials override at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }
  return getCredentialRequirements;
}
