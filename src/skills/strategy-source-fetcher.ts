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

export async function fetchStrategiesFromSource(
  source: StrategySource,
): Promise<{ strategies: FetchedStrategy[]; errors: string[] }> {
  const strategies: FetchedStrategy[] = [];
  const errors: string[] = [];

  const contentsPath = source.path
    ? `https://api.github.com/repos/${source.owner}/${source.repo}/contents/${source.path}?ref=${source.ref}`
    : `https://api.github.com/repos/${source.owner}/${source.repo}/contents?ref=${source.ref}`;

  let entries: GitHubContentEntry[];
  try {
    const res = await fetch(contentsPath, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) {
      errors.push(`Failed to list ${source.id}: HTTP ${res.status}`);
      return { strategies, errors };
    }
    const body = await res.json();
    if (!Array.isArray(body)) {
      errors.push(`Unexpected response from ${source.id}: expected directory listing`);
      return { strategies, errors };
    }
    entries = body as GitHubContentEntry[];
  } catch (err) {
    errors.push(`Failed to list ${source.id}: ${err instanceof Error ? err.message : String(err)}`);
    return { strategies, errors };
  }

  const mdFiles = entries.filter((e) => e.type === 'file' && e.name.endsWith('.md') && !EXCLUDED_FILES.has(e.name));

  for (const file of mdFiles) {
    const rawUrl =
      file.download_url ??
      `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.ref}/${source.path ? source.path + '/' : ''}${file.name}`;

    try {
      const res = await fetch(rawUrl);
      if (!res.ok) {
        errors.push(`Failed to fetch ${file.name} from ${source.id}: HTTP ${res.status}`);
        continue;
      }
      const markdown = await res.text();
      strategies.push({ filename: file.name, markdown, source });
    } catch (err) {
      errors.push(
        `Failed to fetch ${file.name} from ${source.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  logger.info(`Fetched ${strategies.length} strategies from ${source.id}`, {
    total: mdFiles.length,
    errors: errors.length,
  });

  return { strategies, errors };
}
