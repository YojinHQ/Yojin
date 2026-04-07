/**
 * Engagement scorer — extracts engagement metrics from signal metadata
 * and normalizes them to a 0–1 score per source type.
 *
 * Uses log1p scaling so that
 * high-engagement outliers don't dominate — a 10k-like tweet scores ~0.85,
 * not infinitely more than a 1k-like tweet.
 *
 * Source-specific formulas weight the metrics that best indicate signal quality:
 *   - Twitter: likes + retweets (engagement = audience reach × resonance)
 *   - Reddit: score + comments (discussion depth matters more than upvotes alone)
 *   - YouTube: view count (views are the primary engagement signal)
 *   - LinkedIn: likes + comments
 *   - HN: points + comments (quality discussion indicator)
 *   - Research: author-assigned relevance score (already 0–1)
 */

import type { Signal } from '../types.js';

// ---------------------------------------------------------------------------
// Per-source engagement formulas
// ---------------------------------------------------------------------------

/**
 * Normalize a raw engagement metric to 0–1 using log1p.
 * `ceiling` is the value that maps to ~1.0 (e.g. 10_000 likes).
 */
function logNorm(value: number, ceiling: number): number {
  return Math.min(1, Math.log1p(value) / Math.log1p(ceiling));
}

function scoreTwitter(metadata: Record<string, unknown>): number {
  const likes = Number(metadata.likes ?? 0);
  const retweets = Number(metadata.retweets ?? 0);
  // Likes are the primary signal, retweets amplify reach
  return 0.6 * logNorm(likes, 10_000) + 0.4 * logNorm(retweets, 2_000);
}

function scoreReddit(metadata: Record<string, unknown>): number {
  const score = Number(metadata.score ?? 0);
  const numComments = Number(metadata.numComments ?? 0);
  // Reddit: discussion depth (comments) is a strong quality signal
  return 0.5 * logNorm(score, 5_000) + 0.5 * logNorm(numComments, 500);
}

function scoreYouTube(metadata: Record<string, unknown>): number {
  const viewCount = Number(metadata.viewCount ?? 0);
  return logNorm(viewCount, 500_000);
}

function scoreLinkedIn(metadata: Record<string, unknown>): number {
  const likes = Number(metadata.likes ?? 0);
  const comments = Number(metadata.comments ?? 0);
  return 0.6 * logNorm(likes, 1_000) + 0.4 * logNorm(comments, 100);
}

function scoreHackerNews(metadata: Record<string, unknown>): number {
  const points = Number(metadata.points ?? 0);
  const numComments = Number(metadata.numComments ?? 0);
  return 0.5 * logNorm(points, 500) + 0.5 * logNorm(numComments, 200);
}

function scoreResearch(metadata: Record<string, unknown>): number {
  // Research articles already have a 0–1 relevance score from Jintel
  const score = Number(metadata.score ?? 0);
  return Math.min(1, Math.max(0, score));
}

// ---------------------------------------------------------------------------
// Source detection — match sourceName patterns from signal-fetcher.ts
// ---------------------------------------------------------------------------

function detectSource(signal: Signal): string | null {
  const sourceName = signal.sources[0]?.id ?? '';
  if (sourceName.includes('twitter')) return 'twitter';
  if (sourceName.includes('reddit')) return 'reddit';
  if (sourceName.includes('youtube')) return 'youtube';
  if (sourceName.includes('linkedin')) return 'linkedin';
  if (sourceName.includes('discussions') || sourceName.includes('hn')) return 'hn';
  if (sourceName.includes('research')) return 'research';
  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a normalized 0–1 engagement score for a signal based on its
 * source-specific metadata. Returns 0 if the signal has no engagement
 * metadata or comes from an unrecognized source.
 */
export function computeEngagementScore(signal: Signal): number {
  const metadata = signal.metadata;
  if (!metadata) return 0;

  const source = detectSource(signal);
  switch (source) {
    case 'twitter':
      return scoreTwitter(metadata);
    case 'reddit':
      return scoreReddit(metadata);
    case 'youtube':
      return scoreYouTube(metadata);
    case 'linkedin':
      return scoreLinkedIn(metadata);
    case 'hn':
      return scoreHackerNews(metadata);
    case 'research':
      return scoreResearch(metadata);
    default:
      return 0;
  }
}
