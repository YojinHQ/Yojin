import type { StrategySource } from './strategy-source-types.js';
import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('strategy-source-fetcher');

const EXCLUDED_FILES = new Set(['README.md', 'CONTRIBUTING.md', 'LICENSE', 'LICENSE.md']);

export interface FetchedStrategy {
  filename: string;
  markdown: string;
  source: StrategySource;
}

interface GitHubContentEntry {
  name: string;
  type: string;
  download_url: string | null;
}

function checkRateLimit(res: Response, sourceId: string): boolean {
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (remaining === null) return false;
  const count = parseInt(remaining, 10);
  if (count <= 10) {
    const resetEpoch = res.headers.get('x-ratelimit-reset');
    const resetsIn = resetEpoch ? Math.ceil((parseInt(resetEpoch, 10) * 1000 - Date.now()) / 60_000) : '?';
    logger.warn(`GitHub API rate limit low for ${sourceId}: ${remaining} remaining, resets in ~${resetsIn}min`);
  }
  return count === 0;
}

export async function fetchStrategiesFromSource(
  source: StrategySource,
): Promise<{ strategies: FetchedStrategy[]; errors: string[] }> {
  const errors: string[] = [];

  const contentsPath = source.path
    ? `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${source.path}?ref=${source.ref}`
    : `https://api.github.com/repos/${source.owner}/${source.repo}/contents?ref=${source.ref}`;

  let entries: GitHubContentEntry[];
  try {
    const res = await fetch(contentsPath, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Yojin/1.0' },
    });
    const exhausted = checkRateLimit(res, source.id);
    if (!res.ok) {
      errors.push(`Failed to list ${source.id}: HTTP ${res.status}`);
      return { strategies: [], errors };
    }
    if (exhausted) {
      errors.push(`GitHub API rate limit exhausted for ${source.id}, skipping file downloads`);
      return { strategies: [], errors };
    }
    const body = await res.json();
    if (!Array.isArray(body)) {
      errors.push(`Unexpected response from ${source.id}: expected directory listing`);
      return { strategies: [], errors };
    }
    entries = body as GitHubContentEntry[];
  } catch (err) {
    errors.push(`Failed to list ${source.id}: ${err instanceof Error ? err.message : String(err)}`);
    return { strategies: [], errors };
  }

  const mdFiles = entries.filter((e) => e.type === 'file' && e.name.endsWith('.md') && !EXCLUDED_FILES.has(e.name));

  const results = await Promise.allSettled(
    mdFiles.map(async (file) => {
      const rawUrl =
        file.download_url ??
        `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.ref}/${source.path ? source.path + '/' : ''}${file.name}`;

      const res = await fetch(rawUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch ${file.name} from ${source.id}: HTTP ${res.status}`);
      }
      const markdown = await res.text();
      return { filename: file.name, markdown, source };
    }),
  );

  const strategies: FetchedStrategy[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      strategies.push(result.value);
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  logger.info(`Fetched ${strategies.length} strategies from ${source.id}`, {
    total: mdFiles.length,
    errors: errors.length,
  });

  return { strategies, errors };
}
