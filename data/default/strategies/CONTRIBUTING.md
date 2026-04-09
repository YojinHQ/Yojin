# Contributing Strategies

## File Format

Each strategy is a `.md` file with YAML frontmatter followed by Markdown content.

```markdown
---
name: My Strategy Name
description: One-line summary of what the strategy does
category: MARKET
style: momentum
requires:
  - market_data
  - technicals
triggers:
  - type: PRICE_MOVE
    description: Human-readable trigger description
    params:
      threshold: 0.10
      direction: above
tickers: []
maxPositionSize: 0.05
---

## Thesis
Why does this strategy work? ...

## Entry Rules
When to enter positions...

## Exit Rules
When to exit...

## Risk Controls
Position limits, stop losses...
```

## Frontmatter Fields

| Field             | Type     | Required | Description                                                   |
|-------------------|----------|----------|---------------------------------------------------------------|
| `name`            | string   | Yes      | Strategy display name                                         |
| `description`     | string   | Yes      | One-line summary                                              |
| `category`        | enum     | Yes      | `RISK`, `PORTFOLIO`, `MARKET`, or `RESEARCH`                  |
| `style`           | string   | Yes      | Trading style (see conventions below)                         |
| `requires`        | string[] | No       | Data capabilities the strategy needs (defaults to `[]`)       |
| `triggers`        | object[] | Yes      | At least one trigger condition                                |
| `tickers`         | string[] | No       | Specific tickers, or `[]` for all portfolio positions         |
| `maxPositionSize` | number   | No       | Max position as fraction of portfolio (0-1), e.g. `0.05` = 5% |

## Categories

| Category    | Use When                                                                             |
|-------------|--------------------------------------------------------------------------------------|
| `MARKET`    | Strategies that trade based on market signals (momentum, mean-reversion, technicals) |
| `RISK`      | Portfolio maintenance (rebalancing, hedging, drawdown protection)                    |
| `PORTFOLIO` | Allocation and weighting strategies                                                  |
| `RESEARCH`  | Research-driven strategies (sentiment analysis, news-based)                          |

## Style Conventions

Free-form string. Use lowercase with underscores. Established conventions from the seed strategies:

`momentum`, `mean_reversion`, `value`, `technical`, `quant`, `statistical_arb`, `income`, `event_driven`, `carry`, `sentiment`, `risk`

You can use any value, but prefer existing conventions when they fit.

## Data Capabilities

The `requires` array declares what data the strategy needs. Yojin checks availability at activation time and warns if capabilities are missing.

| Capability     | Source                           | Description                         |
|----------------|----------------------------------|-------------------------------------|
| `market_data`  | Jintel market sub-graph          | Prices, quotes, volume              |
| `technicals`   | Jintel technicals sub-graph      | RSI, MACD, Bollinger Bands, etc.    |
| `news`         | Jintel news sub-graph            | News articles                       |
| `research`     | Jintel research sub-graph        | Research reports                    |
| `sentiment`    | Jintel sentiment sub-graph       | Social rank, mentions, momentum     |
| `fundamentals` | Jintel fundamentals              | Earnings, revenue, ratios           |
| `filings`      | Jintel regulatory sub-graph      | SEC filings, regulatory             |
| `derivatives`  | Jintel derivatives (crypto only) | Options chain, futures curve        |
| `portfolio`    | Local PortfolioSnapshotStore     | Positions, weights, PnL             |
| `macro_data`   | Jintel macro signals             | Interest rates, economic indicators |

## Trigger Types

| Type                  | Description                                                      | Common Params                                                 |
|-----------------------|------------------------------------------------------------------|---------------------------------------------------------------|
| `PRICE_MOVE`          | Price change crosses a threshold                                 | `threshold`, `lookback_months` (3, 6, or 12 — omit for daily) |
| `INDICATOR_THRESHOLD` | Technical indicator (RSI, MACD, BB, ...) crosses a value         | `indicator`, `threshold`, `direction`                         |
| `CONCENTRATION_DRIFT` | Position weight exceeds a limit                                  | `maxWeight`                                                   |
| `DRAWDOWN`            | Portfolio or position drawdown                                   | `threshold`                                                   |
| `EARNINGS_PROXIMITY`  | Days until earnings report                                       | `withinDays`                                                  |
| `METRIC_THRESHOLD`    | Numeric metric (SUE, sentiment momentum, P/B, ...) crosses value | `metric`, `threshold`, `direction`                            |
| `SIGNAL_PRESENT`      | A recent Signal of given types/sentiment exists for the ticker   | `signal_types`, `min_sentiment`, `lookback_hours` (≤24)       |
| `CUSTOM`              | User-defined condition                                           | (varies)                                                      |

Trigger `params` are optional and free-form. The Strategist agent interprets them alongside the description.

## Markdown Body

The body after the frontmatter is free-form Markdown. No enforced section structure, but the seed strategies use these sections as a convention:

- **Thesis** -- Why does this strategy work? Include academic references if applicable.
- **Entry Rules** -- Specific, unambiguous conditions for entering positions.
- **Exit Rules** -- Profit targets, stop losses, time-based exits.
- **Risk Controls** -- Position limits, sector caps, timing restrictions.

Write as if explaining to a knowledgeable trader. The Strategist agent reads this content as natural-language instructions.

## Testing Locally

1. Copy your `.md` file to `data/default/strategies/`
2. Run `pnpm dev` -- Yojin seeds new strategies on startup
3. Navigate to `/skills` in the web UI and verify your strategy appears
4. Activate it and check that trigger conditions make sense
5. Or import directly via the Import button (paste the Markdown content)

To validate the frontmatter programmatically:

```typescript
import { parseFromMarkdown } from './src/skills/skill-serializer.js';
import { readFileSync } from 'node:fs';

const md = readFileSync('data/default/strategies/your-strategy.md', 'utf-8');
const skill = parseFromMarkdown(md); // throws on validation errors
console.log(skill.name, skill.triggers.length, 'triggers');
```

## Submission Guidelines

1. One strategy per file, named with kebab-case (`my-strategy-name.md`)
2. Frontmatter must pass Zod validation (run the test above)
3. Include at least Thesis, Entry Rules, Exit Rules, and Risk Controls sections
4. Be specific in trigger descriptions -- vague triggers lead to poor evaluations
5. Set `maxPositionSize` to a reasonable value (most strategies use 3-10%)
6. List all data capabilities the strategy actually uses in `requires`
7. Use `tickers: []` unless the strategy only applies to specific assets
