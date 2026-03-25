/**
 * fetchDataSource resolver — triggers a CLI data source to fetch data,
 * parses the output, and ingests results as signals.
 *
 * Uses spawn with detached stdin — no shell, no injection risk.
 * Currently supports CLI sources. API/MCP adapters are future work.
 */

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { runCli } from '../../../core/run-cli.js';
import { createSubsystemLogger } from '../../../logging/logger.js';
import type { RawSignalInput, SignalIngestor } from '../../../signals/ingestor.js';
import type { EncryptedVault } from '../../../trust/vault/vault.js';

const logger = createSubsystemLogger('fetch-data-source');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let configPath = 'data/config/data-sources.json';
let ingestor: SignalIngestor | null = null;
let vault: EncryptedVault | undefined;

export function setFetchDeps(opts: { configPath: string; ingestor: SignalIngestor; vault?: EncryptedVault }): void {
  configPath = opts.configPath;
  ingestor = opts.ingestor;
  vault = opts.vault;
}

// ---------------------------------------------------------------------------
// Config types (matches data-sources.ts resolver)
// ---------------------------------------------------------------------------

const DataSourceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['CLI', 'MCP', 'API']),
  capabilities: z.array(z.string()),
  enabled: z.boolean(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  baseUrl: z.string().optional(),
  secretRef: z.string().optional(),
  feeds: z.array(z.string().url()).optional(),
});

type DataSourceConfig = z.infer<typeof DataSourceConfigSchema>;

interface FetchResult {
  success: boolean;
  signalsIngested: number;
  duplicates: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// RSS XML parser (minimal — no dependencies)
// ---------------------------------------------------------------------------

interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

function parseRssXml(xml: string): RssItem[] {
  const items: RssItem[] = [];

  // Check root element (first ~500 chars) to distinguish RSS vs Atom
  const head = xml.slice(0, 500);
  const isAtom = /<feed[\s>]/i.test(head) && !/<rss[\s>]/i.test(head);
  const blockRegex = isAtom ? /<entry>([\s\S]*?)<\/entry>/gi : /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = blockRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title');

    let link: string | null;
    let description: string | null;
    let pubDate: string | null;

    if (isAtom) {
      // Atom: <link href="..."/>, <summary>, <updated>
      link = extractAtomLink(block);
      description = extractTag(block, 'summary') ?? extractTag(block, 'content');
      pubDate = extractTag(block, 'updated') ?? extractTag(block, 'published');
    } else {
      // RSS: <link>, <description>, <pubDate>
      link = extractTag(block, 'link');
      description = extractTag(block, 'description');
      pubDate = extractTag(block, 'pubDate');
    }

    if (title) {
      items.push({
        title: decodeXmlEntities(title),
        link: link ?? '',
        description: decodeXmlEntities(description ?? ''),
        pubDate: pubDate ?? new Date().toISOString(),
      });
    }
  }

  return items;
}

/** Extract href from Atom-style <link href="..." /> or <link href="...">...</link> */
function extractAtomLink(xml: string): string | null {
  // Match <link ... href="..." ... /> or <link ... href="..." ...>
  // Prefer rel="alternate" if present, otherwise take first
  const allLinks = [...xml.matchAll(/<link\s[^>]*href=["']([^"']+)["'][^>]*\/?>/gi)];
  if (allLinks.length === 0) return null;
  const alternate = allLinks.find((m) => /rel=["']alternate["']/i.test(m[0]));
  return (alternate ?? allLinks[0])[1];
}

function extractTag(xml: string, tag: string): string | null {
  // Handle CDATA sections
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
  const cdataMatch = cdataRegex.exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();

  // Handle regular text content
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = regex.exec(xml);
  return m ? m[1].trim() : null;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ''); // strip HTML tags from descriptions
}

// ---------------------------------------------------------------------------
// Output → RawSignalInput conversion
// ---------------------------------------------------------------------------

function rssToSignals(items: RssItem[], config: DataSourceConfig): RawSignalInput[] {
  return items.map((item) => ({
    sourceId: config.id,
    sourceName: config.name,
    sourceType: 'RSS' as const,
    reliability: 0.7,
    title: item.title,
    content: item.description || undefined,
    link: item.link || undefined,
    publishedAt: new Date(item.pubDate).toISOString(),
  }));
}

function jsonToSignals(stdout: string, config: DataSourceConfig): RawSignalInput[] {
  const data: unknown = JSON.parse(stdout);
  if (data == null || typeof data !== 'object') return [];

  // Unwrap common response wrappers (e.g. Nimble's { results: [...] })
  const unwrapped = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown>).results)
      ? ((data as Record<string, unknown>).results as unknown[])
      : [data];

  // Filter out non-object/null entries
  const items = unwrapped.filter(
    (item): item is Record<string, unknown> => item != null && typeof item === 'object' && !Array.isArray(item),
  );

  return items
    .filter((item) => item.title || item.headline || item.name)
    .map((item) => ({
      sourceId: config.id,
      sourceName: config.name,
      sourceType: 'API' as const,
      reliability: 0.7,
      title: String(item.title ?? item.headline ?? item.name ?? ''),
      content: item.content ? String(item.content) : item.description ? String(item.description) : undefined,
      link: item.url ? String(item.url) : item.link ? String(item.link) : undefined,
      publishedAt: item.publishedAt
        ? String(item.publishedAt)
        : item.date
          ? String(item.date)
          : new Date().toISOString(),
    }));
}

// ---------------------------------------------------------------------------
// Multi-feed fetcher — runs curl for each configured feed URL
// ---------------------------------------------------------------------------

async function fetchMultipleFeeds(
  config: DataSourceConfig,
  command: string,
  urls: string[],
  env?: Record<string, string>,
): Promise<FetchResult> {
  if (!ingestor) {
    return { success: false, signalsIngested: 0, duplicates: 0, error: 'Signal ingestor not initialized' };
  }

  const ing = ingestor;
  let totalIngested = 0;
  let totalDuplicates = 0;
  const errors: string[] = [];

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const cmdArgs = [...(config.args ?? []), url];
      const { stdout } = await runCli(command, cmdArgs, {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
        ...(env && { env }),
      });

      const trimmed = stdout.trim();
      if (!trimmed) return { url, error: 'empty response' };

      let rawSignals: RawSignalInput[];
      if (trimmed.startsWith('<?xml') || trimmed.startsWith('<rss') || trimmed.startsWith('<feed')) {
        rawSignals = rssToSignals(parseRssXml(trimmed), config);
      } else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        rawSignals = jsonToSignals(trimmed, config);
      } else {
        return { url, error: 'unrecognized format' };
      }

      if (rawSignals.length === 0) return { url, ingested: 0, duplicates: 0 };

      const result = await ing.ingest(rawSignals);
      return { url, ingested: result.ingested, duplicates: result.duplicates, ingestErrors: result.errors };
    }),
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(msg);
    } else {
      const val = result.value;
      if (val.error) {
        errors.push(`${val.url}: ${val.error}`);
      } else {
        totalIngested += val.ingested ?? 0;
        totalDuplicates += val.duplicates ?? 0;
        if (val.ingestErrors && val.ingestErrors.length > 0) errors.push(...val.ingestErrors);
      }
    }
  }

  logger.info(
    `Multi-feed fetch for ${config.id}: ${totalIngested} ingested, ${totalDuplicates} duplicates, ${errors.length} errors`,
  );

  return {
    success: totalIngested > 0 || errors.length === 0,
    signalsIngested: totalIngested,
    duplicates: totalDuplicates,
    error: errors.length > 0 ? errors.join('; ') : null,
  };
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function fetchDataSourceResolver(
  _parent: unknown,
  args: { id: string; url?: string },
): Promise<FetchResult> {
  if (!ingestor) {
    return { success: false, signalsIngested: 0, duplicates: 0, error: 'Signal ingestor not initialized' };
  }

  // Load config with Zod validation
  let configs: DataSourceConfig[];
  try {
    const content = await readFile(configPath, 'utf-8');
    const raw: unknown = JSON.parse(content);
    const result = z.array(DataSourceConfigSchema).safeParse(raw);
    if (!result.success) {
      logger.warn(`Invalid data-sources.json: ${result.error.message}`);
      return { success: false, signalsIngested: 0, duplicates: 0, error: 'Invalid data source config file' };
    }
    configs = result.data;
  } catch {
    return { success: false, signalsIngested: 0, duplicates: 0, error: 'Failed to load data source configs' };
  }

  const config = configs.find((c) => c.id === args.id);
  if (!config) {
    return { success: false, signalsIngested: 0, duplicates: 0, error: `Data source "${args.id}" not found` };
  }
  if (!config.enabled) {
    return { success: false, signalsIngested: 0, duplicates: 0, error: `Data source "${args.id}" is disabled` };
  }

  if (config.type !== 'CLI') {
    return {
      success: false,
      signalsIngested: 0,
      duplicates: 0,
      error: `Fetch not yet supported for type "${config.type}" — only CLI sources are supported`,
    };
  }

  if (!config.command) {
    return { success: false, signalsIngested: 0, duplicates: 0, error: `Data source "${args.id}" has no command` };
  }

  // Resolve API key from vault if secretRef is configured
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  if (config.secretRef && vault?.isUnlocked) {
    try {
      const secret = await vault.get(config.secretRef);
      if (secret) {
        env[config.secretRef] = secret;
      } else {
        return {
          success: false,
          signalsIngested: 0,
          duplicates: 0,
          error: `API key "${config.secretRef}" not found in vault. Add it in Settings → Vault.`,
        };
      }
    } catch {
      return {
        success: false,
        signalsIngested: 0,
        duplicates: 0,
        error: `Failed to read "${config.secretRef}" from vault. Make sure the vault is unlocked.`,
      };
    }
  } else if (config.secretRef && (!vault || !vault.isUnlocked)) {
    return {
      success: false,
      signalsIngested: 0,
      duplicates: 0,
      error: 'Vault is locked. Unlock it first to use data sources that require API keys.',
    };
  }

  // For RSS sources with configured feeds: fetch all feeds (or a single URL if provided)
  const isFeedSource = config.feeds !== undefined || !config.args?.includes('search');
  const feedUrls = args.url ? [args.url] : (config.feeds ?? []);
  if (isFeedSource && feedUrls.length > 0) {
    return fetchMultipleFeeds(config, config.command, feedUrls, env);
  }

  // Build the command args
  const cmdArgs = [...(config.args ?? [])];

  // For Nimble-style sources: if args include "search" subcommand, pass url as --query
  if (args.url) {
    if (cmdArgs.includes('search')) {
      cmdArgs.push('--query', args.url);
    } else {
      cmdArgs.push(args.url);
    }
  }

  try {
    logger.info(`Fetching from ${config.id}: ${config.command} ${cmdArgs.join(' ')}`);

    const { stdout } = await runCli(config.command, cmdArgs, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
      env,
    });

    if (!stdout.trim()) {
      return { success: false, signalsIngested: 0, duplicates: 0, error: 'Command returned empty output' };
    }

    // Detect format: RSS/XML vs JSON
    const trimmed = stdout.trim();
    let rawSignals: RawSignalInput[];

    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<rss') || trimmed.startsWith('<feed')) {
      rawSignals = rssToSignals(parseRssXml(trimmed), config);
    } else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      rawSignals = jsonToSignals(trimmed, config);
    } else {
      const preview = trimmed.slice(0, 120).replace(/\n/g, ' ');
      return {
        success: false,
        signalsIngested: 0,
        duplicates: 0,
        error: `Unrecognized output format (expected XML or JSON). Got: "${preview}..."`,
      };
    }

    if (rawSignals.length === 0) {
      return { success: true, signalsIngested: 0, duplicates: 0, error: null };
    }

    const result = await ingestor.ingest(rawSignals);
    logger.info(`Fetch complete for ${config.id}: ${result.ingested} ingested, ${result.duplicates} duplicates`);

    return {
      success: true,
      signalsIngested: result.ingested,
      duplicates: result.duplicates,
      error: result.errors.length > 0 ? result.errors.join('; ') : null,
    };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string }).stderr?.trim();

    // Friendly error messages for common failures
    let message = raw;
    if (raw.includes('ENOENT')) {
      message = `"${config.command}" is not installed. Install it and try again.`;
    } else if (raw.includes('401') || stderr?.includes('401')) {
      message = `API key "${config.secretRef ?? 'unknown'}" is invalid or expired. Update it in Settings → Vault.`;
    } else if (raw.includes('No module named')) {
      const mod = raw.match(/No module named (\S+)/)?.[1] ?? 'the module';
      message = `Python module "${mod}" is not installed. Run: pip install ${mod}`;
    } else if (raw.includes('Command failed')) {
      // Prefer stderr if available
      message =
        stderr ||
        raw
          .split('\n')
          .filter((l) => !l.startsWith('Command failed:'))
          .join(' ')
          .trim() ||
        raw;
    }

    logger.error(`Fetch failed for ${config.id}: ${message}`);
    return { success: false, signalsIngested: 0, duplicates: 0, error: message };
  }
}
