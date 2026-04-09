/**
 * Strategy source types — external GitHub repositories that provide trading strategies.
 *
 * A StrategySource points to a GitHub repo (owner/repo) with an optional subdirectory
 * and branch ref. The sync engine pulls Markdown strategy files from these sources.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Strategy source schema
// ---------------------------------------------------------------------------

export const StrategySourceSchema = z.object({
  /** Unique identifier, typically "owner/repo". */
  id: z.string().min(1),
  /** GitHub repository owner (user or org). */
  owner: z.string().min(1),
  /** GitHub repository name. */
  repo: z.string().min(1),
  /** Subdirectory within the repo that contains strategy files. */
  path: z.string().default(''),
  /** Git ref (branch or tag) to sync from. */
  ref: z.string().default('main'),
  /** Whether this source is actively synced. */
  enabled: z.boolean().default(true),
  /** ISO 8601 timestamp of the last successful sync. */
  lastSyncedAt: z.string().datetime().optional(),
  /** Human-readable label for the source. */
  label: z.string().optional(),
});

export type StrategySource = z.infer<typeof StrategySourceSchema>;

// ---------------------------------------------------------------------------
// Default source — Yojin's official strategy repo
// ---------------------------------------------------------------------------

export const DEFAULT_STRATEGY_SOURCE: StrategySource = {
  id: 'YojinHQ/trading-strategies',
  owner: 'YojinHQ',
  repo: 'trading-strategies',
  path: 'strategies',
  ref: 'main',
  enabled: true,
  label: 'Yojin Official',
};

export const DEFAULT_SOURCE_ID = DEFAULT_STRATEGY_SOURCE.id;

// ---------------------------------------------------------------------------
// GitHub URL parser
// ---------------------------------------------------------------------------

interface ParsedGitHubUrl {
  owner: string;
  repo: string;
  path: string;
  ref: string;
}

/**
 * Parse a GitHub URL into its constituent parts.
 *
 * Supports:
 * - `https://github.com/owner/repo`
 * - `https://github.com/owner/repo/tree/branch/path/to/dir`
 *
 * @throws Error on invalid or non-GitHub URLs.
 */
export function parseGitHubUrl(url: string): ParsedGitHubUrl {
  if (!url) {
    throw new Error('URL must not be empty');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (parsed.hostname !== 'github.com') {
    throw new Error(`Not a GitHub URL: ${url}`);
  }

  // Remove leading slash and trailing slash, then split
  const segments = parsed.pathname.replace(/^\/|\/$/g, '').split('/');

  if (segments.length < 2 || !segments[0] || !segments[1]) {
    throw new Error(`Missing owner/repo in URL: ${url}`);
  }

  const owner = segments[0];
  const repo = segments[1];

  // Simple URL: https://github.com/owner/repo
  if (segments.length === 2) {
    return { owner, repo, path: '', ref: 'main' };
  }

  // Reject non-tree URL structures (e.g. /blob/, /commit/, /issues/)
  if (segments.length > 2 && segments[2] !== 'tree') {
    throw new Error(
      'Invalid GitHub URL: use https://github.com/owner/repo or https://github.com/owner/repo/tree/branch/path',
    );
  }

  // Tree URL: https://github.com/owner/repo/tree/branch/path/...
  if (segments[2] === 'tree' && segments.length >= 4) {
    const ref = segments[3];
    const path = segments.slice(4).join('/');
    return { owner, repo, path, ref };
  }

  // Tree URL without enough segments (e.g. /tree without a branch)
  return { owner, repo, path: '', ref: 'main' };
}
