# Data Source Plugin System

## Context

Users need to connect their own data feeds — not just built-in sources. A data source is anything that provides market data, sentiment, news, web content, or enrichment. The system is as open as the channel/provider plugin system.

## Three Integration Tiers

| Tier | Transport | Examples | Auth |
|------|-----------|---------|------|
| **CLI** | Spawn subprocess, parse JSON/CSV | Firecrawl CLI, Nimble CLI, Apify CLI, OpenBB, custom scripts | None (local) or env var |
| **MCP** | Model Context Protocol server | Bright Data MCP, Exa MCP, Firecrawl MCP, Apify MCP, Nimble MCP, agentcash (StableEnrich) | Per-server config |
| **API** | REST/GraphQL HTTP calls | All of the above also expose REST APIs | API key via secretctl, x402 wallet |

### Source Compatibility Matrix

| Source | CLI | MCP | API | Async Jobs | Batch | Schema Extraction |
|--------|-----|-----|-----|------------|-------|-------------------|
| Apify | yes | yes | yes | yes (actors, minutes-hours) | yes | no |
| Exa | community | yes | yes | yes (deep research) | no | yes (JSON schema) |
| Bright Data | SDK-CLI | yes | yes | yes (datasets/snapshots) | yes | no |
| StableEnrich | no | yes (agentcash) | yes (x402) | no | no | no |
| Nimble | yes (Go) | yes (SSE) | yes | yes (tasks) | yes (1000 URLs) | no |
| Firecrawl | yes | yes | yes | yes (crawl/extract/agent) | yes | yes (Zod/JSON schema) |

## Architecture

```
User configures data sources → data/config/data-sources.json
                                        ↓
                              DataSourceRegistry
                              (loads, validates, manages lifecycle)
                                        ↓
                    ┌──────────────┬─────┴──────────┐
                    ↓              ↓                 ↓
              CliAdapter      McpAdapter        ApiAdapter
              (spawn + parse) (MCP client)      (HTTP client)
                    └──────────────┴─────────────────┘
                                        ↓
                              DataSourcePlugin interface
                              (uniform query/response + async jobs)
                                        ↓
                              Research Analyst agent
                              (queries by capability)
```

## DataSourcePlugin Interface

The interface must handle two execution patterns discovered across all 6 researched sources:

### Pattern 1: Synchronous Query
Simple request → response. Used for search, single-page scrape, enrichment.
- Exa search, Firecrawl scrape, StableEnrich enrichment, Nimble extract

### Pattern 2: Async Job
Trigger → poll → get results. Used for crawls, dataset collection, multi-page operations.
- Apify actor runs (seconds to hours)
- Bright Data dataset snapshots
- Firecrawl crawl/extract/agent jobs
- Nimble async tasks
- Exa deep research

```typescript
type DataSourceType = 'cli' | 'mcp' | 'api';

interface DataSourcePlugin {
  readonly id: string;
  readonly name: string;
  readonly type: DataSourceType;
  readonly capabilities: DataSourceCapability[];
  enabled: boolean;
  priority: number;

  // Lifecycle
  initialize(config: DataSourceConfig): Promise<void>;
  shutdown(): Promise<void>;
  healthCheck(): Promise<HealthCheckResult>;

  // Synchronous query — immediate result
  query(request: DataQuery): Promise<DataResult>;

  // Async job execution — trigger, poll, retrieve
  startJob?(request: DataQuery): Promise<JobHandle>;
  getJobStatus?(jobId: string): Promise<JobStatus>;
  getJobResult?(jobId: string): Promise<DataResult>;
}

interface DataQuery {
  capability: string;      // "equity-fundamentals", "web-scrape", "news", "sentiment"
  symbol?: string;         // For financial queries
  url?: string;            // For web scraping queries
  urls?: string[];         // For batch operations
  prompt?: string;         // For AI-powered extraction (Firecrawl, Exa)
  schema?: unknown;        // JSON Schema for structured output (Firecrawl, Exa)
  params: Record<string, unknown>;
}

interface DataResult {
  sourceId: string;
  capability: string;
  data: unknown;
  metadata: {
    fetchedAt: string;
    latencyMs: number;
    cached: boolean;
    cost?: number;         // Per-call cost in USD (x402, credit-based)
    creditsUsed?: number;  // Platform credits consumed
  };
}

interface JobHandle {
  jobId: string;
  sourceId: string;
  estimatedDuration?: number;  // Milliseconds, if known
}

type JobStatus =
  | { state: 'running'; progress?: number }
  | { state: 'completed'; resultCount?: number }
  | { state: 'failed'; error: string };
```

### Auth Patterns

Different sources use different auth:

| Pattern | Sources | How we handle it |
|---------|---------|-----------------|
| **API key (Bearer)** | Exa, Firecrawl, Apify, Nimble | secretctl → inject in HTTP header |
| **API key (Basic)** | Nimble MCP | secretctl → Base64 encode |
| **Zone-scoped key** | Bright Data | secretctl + zone config |
| **x402 micropayment** | StableEnrich | Wallet private key in secretctl, x402 fetch wrapper |
| **None (local)** | CLI tools | No auth needed |

### Config: `data/config/data-sources.json`

```json
[
  {
    "id": "firecrawl",
    "name": "Firecrawl",
    "type": "api",
    "capabilities": [
      { "id": "web-scrape", "description": "Single-page content extraction" },
      { "id": "web-crawl", "description": "Multi-page website crawling" },
      { "id": "web-search", "description": "Web search with content" },
      { "id": "structured-extract", "description": "LLM-powered structured extraction" }
    ],
    "config": {
      "type": "api",
      "baseUrl": "https://api.firecrawl.dev",
      "secretRef": "firecrawl-api-key",
      "supportsAsync": true
    }
  },
  {
    "id": "exa",
    "name": "Exa Search",
    "type": "mcp",
    "capabilities": [
      { "id": "web-search", "description": "Neural/keyword web search" },
      { "id": "news", "description": "News search with content" },
      { "id": "sentiment", "description": "Content analysis" }
    ],
    "config": {
      "type": "mcp",
      "serverCommand": "npx -y exa-mcp-server",
      "capabilityMapping": {
        "web-search": "web_search_exa",
        "news": "web_search_exa"
      }
    }
  },
  {
    "id": "brightdata",
    "name": "Bright Data",
    "type": "api",
    "capabilities": [
      { "id": "web-scrape", "description": "Web unlocker with anti-bot bypass" },
      { "id": "web-search", "description": "SERP API" },
      { "id": "social-data", "description": "LinkedIn, TikTok, YouTube data" }
    ],
    "config": {
      "type": "api",
      "baseUrl": "https://api.brightdata.com",
      "secretRef": "brightdata-api-key",
      "supportsAsync": true
    }
  }
]
```

### Capability Resolution

When the Research Analyst needs data:

1. Agent calls `registry.query({ capability: "web-search", params: { query: "NVDA earnings" } })`
2. Registry finds all enabled sources with `web-search` capability, sorted by priority
3. Tries highest-priority source first
4. On failure, falls back to next source
5. For async operations, registry calls `startJob()` → polls `getJobStatus()` → returns `getJobResult()`
6. Caches results in `data/cache/data-sources/`

### Per-Tier Adapters

**CLI Adapter**:
- Spawns subprocess with `child_process.spawn` (no shell injection)
- Parses stdout as JSON, CSV, or NDJSON
- Timeout + kill on hang
- Works with: Firecrawl CLI, Nimble CLI, Apify CLI, OpenBB, custom scripts

**MCP Adapter**:
- Connects to MCP server (stdio or SSE transport)
- Maps capabilities to MCP tools (explicit mapping + auto-discovery)
- Manages server lifecycle (start/stop)
- Works with: All 6 researched sources have MCP servers

**API Adapter**:
- HTTP client (fetch-based)
- Auth injected from secretctl at transport layer (Bearer, Basic, x402)
- Rate limiting per source
- Async job support: POST to trigger, GET to poll status, GET to retrieve results
- Works with: All REST APIs

## User Connection Flow

1. User says "connect Firecrawl" or uses Settings > Data Sources in Web UI
2. System shows available connectors from built-in catalog
3. User provides API key (stored in secretctl) or MCP server command
4. Health check validates the connection
5. Source capabilities become available to the Research Analyst

## Stories

1. **YOJ-58: DataSourcePlugin types + registry** — DONE (PR #11)
2. **YOJ-59: CLI adapter** — subprocess spawning, JSON/CSV parsing, timeout handling
3. **YOJ-60: MCP adapter** — MCP client, tool/resource mapping, server lifecycle
4. **YOJ-61: API adapter** — HTTP client, secretctl auth, rate limiting, async job polling
5. **YOJ-62: Connection flow + config management** — CRUD, catalog, health checks
6. **YOJ-63: Research Analyst integration** — Wire registry into agent tools

## Key Design Decisions

1. **Async is optional** — `startJob`/`getJobStatus`/`getJobResult` are optional interface methods. Sources that only support sync (StableEnrich) just implement `query()`.
2. **Cost metadata, not cost enforcement** — `DataResult.metadata.cost` reports cost but doesn't block. Budget enforcement is a separate concern (guard layer).
3. **MCP is the fastest integration path** — All 6 researched sources have MCP servers. A user can connect any of them by just pointing to the MCP server command.
4. **Schema passthrough** — `DataQuery.schema` passes through to sources that support structured extraction (Firecrawl, Exa). Sources that don't, ignore it.
5. **Batch is a query param, not a separate method** — `DataQuery.urls` (plural) for batch. The adapter handles splitting/aggregating if the source doesn't support native batch.
