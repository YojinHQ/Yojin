# Plan: Add React App via pnpm Workspaces

## Status: DRAFT

## Context

Yojin is currently a single-root package with all backend code in `src/`, plugins in `providers/` and `channels/`. No workspaces, no frontend code, no GraphQL API built yet. We want to add a React web app that connects to the backend via GraphQL.

---

## Decision: Workspace Strategy

### Option A: Additive (keep backend at root)

```
yojin/
├── pnpm-workspace.yaml
├── package.json              ← Root stays as backend package
├── tsconfig.json
├── src/                      ← Backend unchanged
├── providers/
├── channels/
├── apps/
│   └── web/                  ← New React app
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
├── packages/
│   └── types/                ← Shared types (optional, can defer)
└── data/
```

**Pros:** Minimal refactor, no import path changes, fast to ship.
**Cons:** Root package pulls double duty (workspace root + backend). Slightly messier long-term.

### Option B: Full restructure (move backend to apps/server/)

```
yojin/
├── pnpm-workspace.yaml
├── package.json              ← Workspace root only (no source code)
├── tsconfig.base.json        ← Shared TS config
├── apps/
│   ├── server/               ← Backend (moved from root)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   └── web/                  ← New React app
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
├── packages/
│   ├── types/                ← Shared Zod schemas + types
│   └── keelson-client/       ← GraphQL client (from architecture plan)
├── providers/                ← Stay as plugin dirs
├── channels/
└── data/
```

**Pros:** Clean separation, each app owns its own build/deps, scales well.
**Cons:** Big refactor — every import path changes, CI/scripts need updating, `data/` path references change.

### Recommendation: Option A now, Option B later

Option A gets us a working React app in days, not weeks. The backend is still evolving (no GraphQL API, no scraper, no risk module yet), so restructuring now means restructuring code that will change significantly. Once the backend stabilizes (Phase 1 complete), we can restructure to Option B if needed.

---

## Implementation Plan (Option A)

### Phase 0: Workspace Foundation

#### Step 0.1: Create `pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

> Note: `providers/*` and `channels/*` stay as subdirectories of the root package, not separate workspace packages. They don't have their own `package.json` and are compiled by the root `tsconfig.json`. This avoids a massive refactor.

#### Step 0.2: Update root `package.json`

Add workspace-aware scripts:

```jsonc
{
  "scripts": {
    // ... existing scripts stay ...
    "dev:web": "pnpm --filter @yojin/web dev",
    "build:web": "pnpm --filter @yojin/web build",
    "dev:all": "pnpm -r --parallel dev",
    "build:all": "pnpm -r run build",
    "test:all": "pnpm -r run test",
    "ci:all": "pnpm -r run ci"
  }
}
```

#### Step 0.3: Update root `vitest.config.ts`

Scope root vitest to backend tests only (the web app will have its own):

```ts
include: ['src/**/*.test.ts', 'test/**/*.test.ts']
// Remove 'extensions/**/*.test.ts' if unused
```

#### Step 0.4: Update root `eslint.config.js`

Add ignores for workspace packages (they'll have their own lint configs):

```js
ignores: ['dist/', 'node_modules/', 'apps/', 'packages/']
```

---

### Phase 1: React App Scaffold

#### Step 1.1: Create `apps/web/` with Vite + React + TypeScript

```
apps/web/
├── package.json              # @yojin/web
├── tsconfig.json             # Extends root? Or standalone (recommended)
├── tsconfig.node.json        # For vite.config.ts
├── vite.config.ts
├── index.html
├── public/
│   └── favicon.svg
└── src/
    ├── main.tsx              # Entry point
    ├── App.tsx               # Root component
    ├── vite-env.d.ts
    ├── index.css             # Global styles (Tailwind entry)
    ├── components/           # Shared UI components
    ├── pages/                # Route-level components
    ├── hooks/                # Custom React hooks
    ├── lib/                  # Utilities, GraphQL client setup
    └── types/                # Frontend-specific types
```

**Tech choices:**

| Choice | Pick | Why |
|--------|------|-----|
| Build tool | Vite 6 | Fast, ESM-native, aligns with repo's ESM stance |
| React | React 19 | Latest stable |
| Routing | React Router 7 (or TanStack Router) | SPA routing, no SSR needed |
| Styling | Tailwind CSS 4 | Rapid UI dev, good for dashboards |
| GraphQL client | urql or Apollo Client | Lightweight (urql) vs full-featured (Apollo). urql recommended — smaller, simpler |
| Charts | Recharts or Lightweight Charts | Portfolio visualization |
| State management | React Query (TanStack Query) + urql | Server state via urql, no Redux needed |

#### Step 1.2: `apps/web/package.json`

```jsonc
{
  "name": "@yojin/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.0.0",
    "urql": "^4.0.0",
    "graphql": "^16.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "recharts": "^2.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^6.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@testing-library/react": "^16.0.0",
    "jsdom": "^25.0.0"
  }
}
```

#### Step 1.3: Vite config with API proxy

```ts
// apps/web/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/graphql': {
        target: 'http://localhost:3000', // Backend GraphQL endpoint
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

---

### Phase 2: Shared Types Package (optional, can defer)

If the React app needs to share Zod schemas or types with the backend:

#### Step 2.1: Create `packages/types/`

```
packages/types/
├── package.json        # @yojin/types
├── tsconfig.json
└── src/
    ├── index.ts
    ├── portfolio.ts    # PortfolioSnapshot, Position, etc.
    ├── enrichment.ts   # EnrichedSnapshot, Sentiment
    ├── risk.ts         # RiskReport, ExposureBreakdown
    ├── alerts.ts       # AlertRule, AlertResult
    └── config.ts       # Shared config schemas
```

```jsonc
{
  "name": "@yojin/types",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.0.0"
  }
}
```

Then both apps depend on it:
```jsonc
// apps/web/package.json
"dependencies": {
  "@yojin/types": "workspace:*"
}

// Root package.json (backend)
"dependencies": {
  "@yojin/types": "workspace:*"
}
```

**Recommendation:** Defer this until you actually have types to share. Start by duplicating the few types the frontend needs — extract to a shared package when duplication becomes painful (3+ shared types).

---

### Phase 3: GraphQL API (Backend — required for React app)

The React app needs a GraphQL endpoint. This is already planned in the architecture as `src/api/graphql/`.

#### Step 3.1: Add backend dependencies

```bash
pnpm add graphql graphql-yoga hono @hono/node-server
```

#### Step 3.2: Create `src/api/graphql/`

```
src/api/graphql/
├── index.ts          # Export createGraphQLServer()
├── schema.ts         # GraphQL schema definition (code-first or SDL)
├── resolvers/
│   ├── portfolio.ts  # Portfolio queries
│   ├── enrichment.ts # Enrichment data queries
│   ├── risk.ts       # Risk report queries
│   ├── alerts.ts     # Alert queries + mutations
│   └── agents.ts     # Agent status, session queries
├── subscriptions/
│   └── portfolio.ts  # Real-time portfolio updates (SSE)
└── context.ts        # GraphQL context builder (from YojinContext)
```

#### Step 3.3: GraphQL schema (initial)

Start with read-only queries that expose existing data:

```graphql
type Query {
  # Portfolio
  portfolio: Portfolio
  positions: [Position!]!
  position(symbol: String!): Position

  # Enrichment
  enrichedSnapshot: EnrichedSnapshot

  # Risk
  riskReport: RiskReport

  # Alerts
  alerts: [Alert!]!

  # Agent status
  agents: [AgentStatus!]!

  # Brain (Strategist)
  brainState: BrainState
}

type Subscription {
  portfolioUpdated: Portfolio
  alertTriggered: Alert
  agentActivity: AgentEvent
}
```

#### Step 3.4: Mount on Hono server

```ts
// src/api/server.ts
import { Hono } from 'hono';
import { createYoga } from 'graphql-yoga';

const app = new Hono();
const yoga = createYoga({ schema, context: buildContext });

app.use('/graphql', async (c) => {
  const response = await yoga.handle(c.req.raw);
  return response;
});
```

---

### Phase 4: React App Core Pages

#### Step 4.1: Page structure

```
src/pages/
├── Dashboard.tsx       # Portfolio overview, key metrics, alerts
├── Positions.tsx       # Positions table with enrichment data
├── Position.tsx        # Single position deep-dive (charts, sentiment, risk)
├── Risk.tsx            # Risk dashboard (exposure, concentration, correlation)
├── Agents.tsx          # Agent status, session history, brain state
├── Alerts.tsx          # Alert rules management, history
└── Settings.tsx        # Config management
```

#### Step 4.2: Component architecture

```
src/components/
├── layout/
│   ├── AppShell.tsx       # Sidebar + header + content area
│   ├── Sidebar.tsx        # Navigation
│   └── Header.tsx         # Status bar, notifications
├── portfolio/
│   ├── PortfolioSummary.tsx    # Total value, P&L, allocation pie
│   ├── PositionCard.tsx        # Position with sparkline
│   └── PositionTable.tsx       # Sortable positions table
├── charts/
│   ├── PriceChart.tsx         # Candlestick/line chart
│   ├── AllocationChart.tsx    # Pie/donut chart
│   └── PerformanceChart.tsx   # Line chart with benchmarks
├── risk/
│   ├── ExposureBreakdown.tsx  # Sector/geography/asset class
│   ├── ConcentrationScore.tsx # Visual risk gauge
│   └── CorrelationMatrix.tsx  # Heatmap
├── agents/
│   ├── AgentCard.tsx          # Agent status + last activity
│   └── BrainViewer.tsx        # Strategist cognitive state viewer
└── common/
    ├── Card.tsx
    ├── Badge.tsx
    ├── Spinner.tsx
    └── EmptyState.tsx
```

---

### Phase 5: Dev Workflow Updates

#### Step 5.1: Update Husky pre-push hook

```bash
# .husky/pre-push
pnpm format:check && pnpm typecheck && pnpm lint && pnpm test:ci
pnpm --filter @yojin/web typecheck && pnpm --filter @yojin/web lint
```

Or simpler — use workspace-aware commands:

```bash
pnpm -r run typecheck && pnpm -r run lint && pnpm test:ci
```

#### Step 5.2: Update `.gitignore`

```gitignore
# Add
apps/web/dist/
```

#### Step 5.3: Development workflow

```bash
# Terminal 1: Backend
pnpm dev

# Terminal 2: Frontend
pnpm dev:web

# Or both at once:
pnpm dev:all
```

#### Step 5.4: Update README.md

Add new commands, update project structure, add web app section.

---

## Execution Order

```
Phase 0 → Phase 1 → Phase 3 → Phase 4
                ↘ Phase 2 (defer until needed)
```

| Step | Description | Estimate |
|------|-------------|----------|
| 0.1–0.4 | Workspace foundation | Small |
| 1.1–1.3 | React app scaffold (empty shell) | Small |
| 3.1–3.4 | GraphQL API backend | Medium — this is the real work |
| 4.1–4.2 | React pages + components | Medium-Large |
| 5.1–5.4 | Dev workflow polish | Small |
| 2.1 | Shared types package | Defer |

---

## Open Questions

1. **Routing:** React Router 7 vs TanStack Router? (React Router is more established, TanStack has better TypeScript support)
2. **GraphQL schema approach:** Code-first (Pothos) vs SDL-first? Code-first gives better type safety with TypeScript.
3. **Auth for web app:** Reuse existing OAuth PKCE flow? Or add a simpler session-based auth for the web UI?
4. **Real-time updates:** GraphQL subscriptions over SSE (graphql-yoga supports this natively) vs separate SSE endpoint?
5. **Charts library:** Recharts (React-native, easy) vs TradingView Lightweight Charts (financial-grade, more complex)?
6. **Do we need the shared types package now**, or start with types co-located in the web app and extract later?
