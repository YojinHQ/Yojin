/**
 * Screenshot connector — wraps the screenshot parser as a TieredPlatformConnector.
 *
 * Instantiated per-import: each screenshot creates a new connector instance.
 * The connector is stateless — no auth, no session, always available.
 */

import type { Platform } from '../../api/graphql/types.js';
import { parsePortfolioScreenshot } from '../screenshot-parser.js';
import type {
  IntegrationTier,
  ParseScreenshotParams,
  PlatformConnectorResult,
  TieredPlatformConnector,
} from '../types.js';

export class ScreenshotConnector implements TieredPlatformConnector {
  readonly platformId: string;
  readonly platformName: string;
  readonly tier: IntegrationTier = 'SCREENSHOT';

  constructor(
    private readonly params: ParseScreenshotParams,
    platform?: Platform,
  ) {
    const resolved = platform ?? params.platformHint ?? 'MANUAL';
    this.platformId = resolved;
    this.platformName = `${resolved} Screenshot Import`;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async connect(_credentialRefs: string[]): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }

  async disconnect(): Promise<void> {
    // No-op — stateless connector
  }

  async fetchPositions(): Promise<PlatformConnectorResult> {
    return parsePortfolioScreenshot(this.params);
  }
}
