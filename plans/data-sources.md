# Data Source Plugin System

## Context

Users need to connect their own data feeds — not just the built-in OpenBB and Keelson sources. A data source is anything that provides market data, sentiment, news, or enrichment. The system should be as open as the channel/provider plugin system.

## Three Integration Tiers

| Tier | Transport | Example | Auth |
|------|-----------|---------|------|
| **CLI** | Spawn subprocess, parse JSON/CSV output | `openbb`, custom scripts, `yfinance` wrapper | None (local) |
| **MCP** | Model Context Protocol server (tools + resources) | Twitter MCP, Reddit MCP, Bloomberg MCP | Per-server config |
| **API** | REST/GraphQL HTTP calls | Keelson, Alpha Vantage, Polygon.io, NewsAPI | API key via secretctl |

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
                              (uniform query/response)
                                        ↓
                              Research Analyst agent
                              (queries by capability)
```

### DataSourcePlugin Interface

```typescript
type DataSourceType = 'cli' | 'mcp' | 'api';

interface DataSourceCapability {
  id: string;            // "equity-fundamentals", "news", "sentiment", "technicals"
  description: string;
}

interface DataSourcePlugin {
  id: string;
  name: string;
  type: DataSourceType;
  capabilities: DataSourceCapability[];
  enabled: boolean;
  priority: number;      // Lower = preferred when multiple sources offer same capability

  initialize(config: DataSourceConfig): Promise<void>;
  query(request: DataQuery): Promise<DataResult>;
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }>;
  shutdown(): Promise<void>;
}

interface DataQuery {
  capability: string;    // What kind of data
  symbol?: string;       // Ticker/asset
  params: Record<string, unknown>;  // Capability-specific params
}

interface DataResult {
  sourceId: string;
  capability: string;
  data: unknown;         // Capability-specific response (validated by consumer)
  metadata: {
    fetchedAt: string;
    latencyMs: number;
    cached: boolean;
  };
}
```

### Config: `data/config/data-sources.json`

```json
[
  {
    "id": "openbb",
    "name": "OpenBB SDK",
    "type": "cli",
    "command": "openbb",
    "args": ["--output", "json"],
    "capabilities": ["equity-fundamentals", "technicals", "news", "crypto"],
    "enabled": true,
    "priority": 1
  },
  {
    "id": "twitter-sentiment",
    "name": "Twitter Sentiment MCP",
    "type": "mcp",
    "serverCommand": "npx @yojin/twitter-mcp",
    "capabilities": ["social-sentiment", "news"],
    "enabled": true,
    "priority": 2
  },
  {
    "id": "keelson",
    "name": "Keelson API",
    "type": "api",
    "baseUrl": "https://api.keelson.io/graphql",
    "secretRef": "keelson-api-key",
    "capabilities": ["sentiment", "enrichment"],
    "enabled": true,
    "priority": 1
  }
]
```

### Capability Resolution

When the Research Analyst needs data:

1. Agent calls `dataSourceRegistry.query({ capability: "equity-fundamentals", symbol: "AAPL" })`
2. Registry finds all enabled sources with that capability, sorted by priority
3. Tries the highest-priority source first
4. On failure, falls back to next source
5. Caches successful results in `data/cache/data-sources/`

### Per-Tier Adapters

**CLI Adapter**:
- Spawns subprocess with structured arguments
- Parses stdout as JSON (or CSV with header detection)
- Timeout + kill on hang
- Validates CLI tool exists at initialize time

**MCP Adapter**:
- Connects to MCP server (stdio or SSE transport)
- Maps capabilities to MCP tools/resources
- Manages server lifecycle (start/stop)
- Reuses existing MCP client patterns

**API Adapter**:
- HTTP client (fetch-based)
- API key injected from secretctl at transport layer
- Rate limiting per source
- Response validation via Zod schemas

## User Connection Flow

1. User says "connect my Twitter feed" or navigates to Settings > Data Sources in Web UI
2. System shows available connectors (built-in + discovered MCP servers)
3. User provides config (API key, MCP server URL, CLI path)
4. Credentials stored in secretctl, config in `data/config/data-sources.json`
5. Health check validates the connection
6. Source appears in the Research Analyst's available data feeds

## Stories

1. **DataSourcePlugin types + registry** — Interface, Zod config schema, DataSourceRegistry with capability resolution + fallback
2. **CLI adapter** — Subprocess spawning, JSON/CSV parsing, timeout handling, health check
3. **MCP adapter** — MCP client integration, tool/resource mapping, server lifecycle
4. **API adapter** — HTTP client, secretctl auth injection, rate limiting, Zod response validation
5. **Connect flow + config management** — User-facing connection CRUD, health check, Web UI settings integration
6. **Research Analyst integration** — Wire data sources into Research Analyst tools, replace hardcoded OpenBB/Keelson with registry queries

## Dependencies

- secretctl (YOJ-44) for API key storage
- ToolRegistry for exposing data source queries as agent tools
- Research Analyst agent profile for tool scoping
