# Yojin Web App — `apps/web/`

React 19 dashboard for the Yojin AI finance agent. Dark-themed portfolio intelligence UI.

## Tech Stack

- **React 19** + **React Router 7** (nested routes via `<Outlet>`)
- **Vite 6** with `@vitejs/plugin-react` + `@tailwindcss/vite`
- **Tailwind CSS 4** — uses `@theme` syntax in `index.css`, no `tailwind.config.js`
- **urql 4** — GraphQL client, configured in `src/lib/graphql.ts`
- **Recharts** — charting library for portfolio visualizations
- **Storybook 10** — component dev on port 6006
- **TypeScript 5.7** strict, module resolution: `bundler`

## Commands

```bash
pnpm dev:web          # Vite dev server on :5173
pnpm build:web        # tsc -b && vite build
pnpm --filter web storybook   # Storybook on :6006
pnpm --filter web test        # vitest
pnpm --filter web typecheck   # tsc --noEmit
pnpm --filter web lint        # eslint src/
```

## Architecture

### Layout

```
┌──────────────────────────────────────┐
│            Header (breadcrumb)       │
├──────────┬───────────────┬───────────┤
│ Sidebar  │   Content     │  Right    │
│ (nav)    │  (<Outlet>)   │  Panel    │
│          │               │  (news)   │
└──────────┴───────────────┴───────────┘
```

`AppShell` (`components/layout/app-shell.tsx`) wraps all routes with sidebar + header + right panel.

### Directory Structure

```
src/
├── components/
│   ├── common/       # Reusable primitives (Button, Card, Badge, Input, Modal, Toggle, Tabs, Spinner)
│   ├── layout/       # App shell, Sidebar, Header, RightPanel, UserMenu
│   ├── overview/     # Dashboard-specific widgets
│   ├── portfolio/    # Portfolio page components
│   ├── charts/       # Data visualization components
│   ├── chat/         # Chat interface components
│   └── skills/       # Alert rules & skills UI
├── pages/            # Route pages (Dashboard, Positions, Position, Chat, Skills, Profile, Settings)
├── lib/              # Utilities (graphql client, theme provider, cn() helper)
├── App.tsx           # Route definitions
├── main.tsx          # React entry point
└── index.css         # Tailwind @theme tokens + light/dark variables
```

### Routing

Routes defined in `App.tsx`, all nested under `<AppShell>`:

| Path | Page | Description |
|------|------|-------------|
| `/` | Dashboard | Overview with portfolio chart, positions preview, news |
| `/portfolio` | Positions | Full position table with filters |
| `/portfolio/:symbol` | Position | Single position detail |
| `/insights` | Insights | Multi-agent portfolio analysis |
| `/signals` | Signals | Signal archive with search, filters, deep-linking |
| `/chat` | Chat | AI chat REPL |
| `/skills` | Skills | Alert rules and skill browser |
| `/profile` | Profile | User profile |
| `/settings` | Settings | App settings |

## Styling Conventions

### Theme Tokens

All colors are CSS custom properties defined in `src/index.css` via Tailwind `@theme`. Use these tokens — never hardcode hex values:

- **Backgrounds**: `bg-bg-primary`, `bg-bg-secondary`, `bg-bg-tertiary`, `bg-bg-hover`, `bg-bg-card`
- **Borders**: `border-border`, `border-border-light`
- **Text**: `text-text-primary`, `text-text-secondary`, `text-text-muted`
- **Accent**: `text-accent-primary`, `bg-accent-glow`
- **Status**: `text-success`, `text-warning`, `text-error`, `text-info`
- **Fonts**: `font-headline` (Young Serif), `font-body` (Inter)

Light/dark theming switches automatically via `[data-theme='light']` CSS overrides.

### `cn()` Utility

Always use `cn()` from `lib/utils.ts` (clsx + tailwind-merge) for conditional/merged class names:

```tsx
<div className={cn('p-4 rounded-lg', isActive && 'bg-accent-glow', className)} />
```

### Component Variant Pattern

Components use Record maps for variant styles:

```tsx
const variantStyles: Record<Variant, string> = {
  primary: 'bg-accent-primary text-white',
  secondary: 'bg-bg-tertiary text-text-primary',
  ghost: 'bg-transparent text-text-secondary',
};
```

## Component Guidelines

- **File names**: kebab-case (`portfolio-chart.tsx`, `filter-tabs.tsx`)
- **Exports**: named exports, not default exports
- **Props**: extend native HTML attributes where applicable (`ButtonHTMLAttributes`, etc.)
- **State**: local `useState` for UI state; urql for server state via GraphQL
- **No global state library** — component state + GraphQL covers current needs
- **Stories**: co-locate as `*.stories.tsx` next to the component in any directory

## Empty State Pattern — Blur Gate

All feature-gated and empty states must show **mock data behind a frosted blur overlay** with a branded gate card on top. This gives users a preview of what the feature looks like when populated.

### Components

| Component | Level | Purpose |
|-----------|-------|---------|
| `CardBlurGate` | Card | Wraps mock content + overlay inside a `DashboardCard` |
| `PageBlurGate` | Page | Wraps a full mock page + overlay, replaces `PageFeatureGate` |
| `FeatureCardGate` | Card | Branded gate card (logo + title + CTA) for card overlays |
| `GateCard` | Any | Standalone branded gate card with customizable text |

### Branding

- **Jintel gates**: Show Yojin logo (`/brand/yojin_icon_color.png`)
- **AI gates**: Show Claude + OpenAI logos (`/ai-providers/claude.png`, `/ai-providers/openai.png`) stacked with overlap

### Card-level pattern (dashboard cards)

```tsx
<DashboardCard title="Portfolio Value">
  <CardBlurGate mockContent={<MockPortfolioValue />}>
    <FeatureCardGate requires="jintel" />
  </CardBlurGate>
</DashboardCard>
```

### Page-level pattern (full pages)

```tsx
export default function Positions() {
  return (
    <PageBlurGate requires="jintel" mockContent={<MockPortfolioPage />}>
      <PositionsContent />
    </PageBlurGate>
  );
}
```

### Mock content rules

- Mock data is **static** — no API calls, no hooks, no `useQuery`
- Use `pointer-events-none select-none aria-hidden` (handled by blur gate components)
- Use placeholder circles (`bg-bg-tertiary rounded-full`) instead of `SymbolLogo` to avoid API calls
- Match the populated state's layout exactly (same table structure, same grid, same spacing)
- Use realistic but obviously fake values ($127,450.32, AAPL, NVDA, BTC, etc.)

### When to use

- Every `PageFeatureGate` should be replaced with `PageBlurGate` + mock content
- Every `FeatureCardGate` inside a dashboard card should be wrapped in `CardBlurGate`
- Every `CardEmptyState` (no data yet) should also be wrapped in `CardBlurGate` with mock content

## GraphQL

- Client configured in `src/lib/graphql.ts` with `cacheExchange` + `fetchExchange`
- Vite proxies `/graphql` and `/api` to `http://localhost:3000` (backend) in dev
- Env var `VITE_GRAPHQL_URL` overrides the endpoint

## Data

Pages currently use mock data arrays (e.g., `mockPositions` in `positions.tsx`). These will be replaced with GraphQL queries as the backend API matures.
