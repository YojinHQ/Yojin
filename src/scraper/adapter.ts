/**
 * Platform tools adapter — registers onboarding tools with ToolRegistry.
 */

import { z } from 'zod';

import type { ConnectionManager } from './connection-manager.js';
import { IntegrationTierSchema, PlatformSchema } from './types.js';
import type { IntegrationTier } from './types.js';
import type { Platform } from '../api/graphql/types.js';
import type { ToolDefinition, ToolResult } from '../core/types.js';

export function createPlatformTools(connectionManager: ConnectionManager): ToolDefinition[] {
  const connectPlatform: ToolDefinition = {
    name: 'connect_platform',
    description:
      'Connect an investment platform. ' +
      'Call with just platform to see available tiers and credential requirements. ' +
      'Call with platform + tier to run the full connection flow. Credentials must already be stored in the vault.',
    parameters: z.object({
      platform: PlatformSchema.describe('Platform to connect'),
      tier: IntegrationTierSchema.optional().describe('Integration tier (auto-detect if omitted)'),
    }),
    async execute(params: { platform: string; tier?: string }): Promise<ToolResult> {
      try {
        const { platform, tier } = params;

        // Phase 1: No tier → return available tiers with credential requirements
        if (!tier) {
          const tiers = await connectionManager.detectAvailableTiers(platform as Platform);
          const available = tiers.filter((t) => t.available);
          if (available.length === 0) {
            return { content: `No integration tiers available for ${platform}.` };
          }
          const lines = available.map((t) => {
            const creds =
              t.requiresCredentials.length > 0 ? `needs: ${t.requiresCredentials.join(', ')}` : 'no credentials needed';
            return `  - ${t.tier}: ${creds}`;
          });
          return {
            content: `Available tiers for ${platform} (best first):\n${lines.join('\n')}\n\nStore required credentials in the vault, then call connect_platform with the chosen tier.`,
          };
        }

        // Phase 2: Tier specified → run full connection flow
        const result = await connectionManager.connectPlatform({
          platform: platform as Platform,
          tier: tier as IntegrationTier,
        });
        if (!result.success) {
          return { content: `Connection failed: ${result.error}`, isError: true };
        }
        return {
          content: `Connected to ${platform} via ${tier}. Status: ${result.connection?.status}.`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Connection error: ${message}`, isError: true };
      }
    },
  };

  const disconnectPlatform: ToolDefinition = {
    name: 'disconnect_platform',
    description: 'Disconnect an investment platform and optionally remove stored credentials.',
    parameters: z.object({
      platform: PlatformSchema.describe('Platform to disconnect'),
      removeCredentials: z.boolean().default(false).describe('Also remove stored credentials from vault'),
    }),
    async execute(params: { platform: string; removeCredentials: boolean }): Promise<ToolResult> {
      try {
        const result = await connectionManager.disconnectPlatform(params.platform as Platform, {
          removeCredentials: params.removeCredentials,
        });
        if (!result.success) {
          return { content: `Disconnect failed: ${result.error}`, isError: true };
        }
        return {
          content: `${params.platform} disconnected.${params.removeCredentials ? ' Credentials removed.' : ''}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Connection error: ${message}`, isError: true };
      }
    },
  };

  const listConnections: ToolDefinition = {
    name: 'list_connections',
    description: 'List all connected investment platforms with their status.',
    parameters: z.object({}),
    async execute(): Promise<ToolResult> {
      try {
        const connections = await connectionManager.listConnections();
        if (connections.length === 0) {
          return { content: 'No connections configured.' };
        }
        const lines = connections.map(
          (c) => `  - ${c.platform} (${c.tier}): ${c.status}${c.lastSync ? ` — last sync: ${c.lastSync}` : ''}`,
        );
        return { content: `Platform connections:\n${lines.join('\n')}` };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Connection error: ${message}`, isError: true };
      }
    },
  };

  return [connectPlatform, disconnectPlatform, listConnections];
}
