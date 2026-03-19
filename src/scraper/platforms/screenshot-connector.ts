/**
 * Screenshot connector — wraps the screenshot parser as a PlatformConnector.
 *
 * Instantiated per-import: each screenshot creates a new connector instance.
 * The connector is stateless — no auth, no session, always available.
 */

import { parsePortfolioScreenshot } from '../screenshot-parser.js';
import type { ParseScreenshotParams, PlatformConnector, PlatformConnectorResult } from '../types.js';

export class ScreenshotConnector implements PlatformConnector {
  readonly platformId = 'screenshot';
  readonly platformName = 'Screenshot Import';

  constructor(private readonly params: ParseScreenshotParams) {}

  async fetchPositions(): Promise<PlatformConnectorResult> {
    return parsePortfolioScreenshot(this.params);
  }
}
