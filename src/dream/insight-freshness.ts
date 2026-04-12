/**
 * Insight freshness pass — the second phase of a dream run.
 *
 * 1. Thesis staleness: detect position insights whose key signals are resolved or aged out
 * 2. Action item expiry: auto-expire snap action items older than configured window
 * 3. Cross-report dedup: graduate repeated theses into ticker profile entries
 */

import type { DreamConfig, InsightFreshnessResult } from './types.js';
import type { InsightStore } from '../insights/insight-store.js';
import type { InsightReport, PositionInsight } from '../insights/types.js';
import { createSubsystemLogger } from '../logging/logger.js';
import type { TickerProfileStore } from '../profiles/profile-store.js';
import type { ProfileEntryCategory } from '../profiles/types.js';
import type { SignalArchive } from '../signals/archive.js';
import type { SnapStore } from '../snap/snap-store.js';

const logger = createSubsystemLogger('dream-insight-freshness');

// ---------------------------------------------------------------------------
// Thesis staleness detection
// ---------------------------------------------------------------------------

interface StaleThesis {
  symbol: string;
  reportId: string;
  reason: string;
}

async function detectStaleTheses(
  insightStore: InsightStore,
  signalArchive: SignalArchive,
  config: DreamConfig,
): Promise<StaleThesis[]> {
  const latest = await insightStore.getLatest();
  if (!latest) return [];

  const staleTheses: StaleThesis[] = [];
  const staleCutoff = Date.now() - config.staleInsightDays * 24 * 60 * 60 * 1000;

  // Check if the report itself is old
  const reportAge = new Date(latest.createdAt).getTime();
  if (reportAge < staleCutoff) {
    // Entire report is stale — mark all non-carried-forward positions
    for (const position of latest.positions) {
      if (!position.carriedForward) {
        staleTheses.push({
          symbol: position.symbol,
          reportId: latest.id,
          reason: `Report is ${Math.round((Date.now() - reportAge) / (24 * 60 * 60 * 1000))}d old`,
        });
      }
    }
    return staleTheses;
  }

  // For each position, check if its key signals are still live
  for (const position of latest.positions) {
    if (position.carriedForward) continue;

    const staleness = await checkPositionStaleness(position, signalArchive, config);
    if (staleness) {
      staleTheses.push({
        symbol: position.symbol,
        reportId: latest.id,
        reason: staleness,
      });
    }
  }

  return staleTheses;
}

async function checkPositionStaleness(
  position: PositionInsight,
  signalArchive: SignalArchive,
  config: DreamConfig,
): Promise<string | null> {
  if (position.keySignals.length === 0) return 'No key signals backing thesis';

  // Check if any key signals are still in the archive (not dismissed)
  const signalIds = position.keySignals.map((s) => s.signalId);
  const dismissed = await signalArchive.getDismissedIds();
  const liveSignals = signalIds.filter((id) => !dismissed.has(id));

  if (liveSignals.length === 0) {
    return 'All key signals dismissed or expired';
  }

  // Check if we have any recent signals for this ticker
  const since = new Date(Date.now() - config.staleInsightDays * 24 * 60 * 60 * 1000).toISOString();
  const recentSignals = await signalArchive.query({
    ticker: position.symbol,
    since,
    limit: 1,
  });

  if (recentSignals.length === 0) {
    return `No signals for ${position.symbol} in last ${config.staleInsightDays}d`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Action item expiry
// ---------------------------------------------------------------------------

async function expireStaleActionItems(snapStore: SnapStore, config: DreamConfig): Promise<number> {
  const snap = await snapStore.getLatest();
  if (!snap) return 0;

  const staleCutoff = Date.now() - config.staleActionItemDays * 24 * 60 * 60 * 1000;
  const snapAge = new Date(snap.generatedAt).getTime();

  // If the snap itself is older than the cutoff, all action items are stale
  if (snapAge < staleCutoff) {
    const count = snap.actionItems.length;
    if (count > 0) {
      // Clear action items but keep the snap structure
      await snapStore.save({
        ...snap,
        actionItems: [],
        generatedAt: new Date().toISOString(),
      });
      logger.info('Expired all action items from stale snap', { count });
    }
    return count;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Cross-report thesis dedup → ticker profile graduation
// ---------------------------------------------------------------------------

async function graduateRepeatedTheses(
  insightStore: InsightStore,
  profileStore: TickerProfileStore,
  _config: DreamConfig,
): Promise<number> {
  // Look at recent reports to find repeated theses for the same ticker
  const reports = await insightStore.getRecent(10);
  if (reports.length < 3) return 0;

  // Group theses by ticker across reports
  const thesesByTicker = new Map<string, Array<{ thesis: string; report: InsightReport; position: PositionInsight }>>();

  for (const report of reports) {
    for (const position of report.positions) {
      if (position.carriedForward) continue;
      let group = thesesByTicker.get(position.symbol);
      if (!group) {
        group = [];
        thesesByTicker.set(position.symbol, group);
      }
      group.push({ thesis: position.thesis, report, position });
    }
  }

  const entries: Array<{
    ticker: string;
    category: ProfileEntryCategory;
    observation: string;
    evidence: string;
    insightReportId: string;
    insightDate: string;
    rating: PositionInsight['rating'] | null;
    conviction: number | null;
  }> = [];

  for (const [ticker, theses] of thesesByTicker) {
    if (theses.length < 3) continue;

    // Check if theses are similar (same rating direction across 3+ reports)
    const ratings = theses.map((t) => t.position.rating);
    const bullishCount = ratings.filter((r) => r === 'BULLISH' || r === 'VERY_BULLISH').length;
    const bearishCount = ratings.filter((r) => r === 'BEARISH' || r === 'VERY_BEARISH').length;

    // Consistent direction = pattern worth persisting
    if (bullishCount >= 3 || bearishCount >= 3) {
      const latest = theses[0];
      const direction = bullishCount >= 3 ? 'bullish' : 'bearish';

      entries.push({
        ticker,
        category: 'PATTERN',
        observation: `Persistent ${direction} thesis across ${theses.length} reports: ${latest.thesis.slice(0, 200)}`,
        evidence: `Consistent ${direction} rating in ${theses.length} consecutive insight reports`,
        insightReportId: latest.report.id,
        insightDate: latest.report.createdAt,
        rating: latest.position.rating,
        conviction: latest.position.conviction,
      });
    }
  }

  if (entries.length > 0) {
    await profileStore.storeBatch(
      entries.map((e) => ({
        ticker: e.ticker,
        category: e.category,
        observation: e.observation,
        evidence: e.evidence,
        insightReportId: e.insightReportId,
        insightDate: e.insightDate,
        rating: e.rating,
        conviction: e.conviction,
        priceAtObservation: null,
        grade: null,
        actualReturn: null,
      })),
    );
    logger.info('Graduated repeated theses to ticker profiles', { count: entries.length });
  }

  return entries.length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InsightFreshnessDeps {
  insightStore: InsightStore;
  signalArchive: SignalArchive;
  snapStore: SnapStore;
  profileStore: TickerProfileStore;
}

export async function runInsightFreshness(
  deps: InsightFreshnessDeps,
  config: DreamConfig,
): Promise<InsightFreshnessResult> {
  const [staleTheses, expiredActionItems, profileEntriesCreated] = await Promise.all([
    detectStaleTheses(deps.insightStore, deps.signalArchive, config),
    expireStaleActionItems(deps.snapStore, config),
    graduateRepeatedTheses(deps.insightStore, deps.profileStore, config),
  ]);

  if (staleTheses.length > 0) {
    logger.info('Detected stale theses', {
      count: staleTheses.length,
      symbols: staleTheses.map((t) => t.symbol),
    });
  }

  return { staleTheses, expiredActionItems, profileEntriesCreated };
}
