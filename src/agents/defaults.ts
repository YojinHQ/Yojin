/**
 * Default agent profiles — aggregates the four Yojin agent profiles.
 *
 * Each profile lives in its own file under profiles/ for independent evolution.
 * This module provides a single convenience function for the composition root.
 */

import { createBearResearcherProfile } from './profiles/bear-researcher.js';
import { createBullResearcherProfile } from './profiles/bull-researcher.js';
import { createResearchAnalystProfile } from './profiles/research-analyst.js';
import { createRiskManagerProfile } from './profiles/risk-manager.js';
import { createStrategistProfile } from './profiles/strategist.js';
import { createStrategyArchitectProfile } from './profiles/strategy-architect.js';
import { createTraderProfile } from './profiles/trader.js';
import type { AgentProfile } from './types.js';

export function createDefaultProfiles(): AgentProfile[] {
  return [
    createResearchAnalystProfile(),
    createStrategistProfile(),
    createStrategyArchitectProfile(),
    createRiskManagerProfile(),
    createTraderProfile(),
    createBullResearcherProfile(),
    createBearResearcherProfile(),
  ];
}
