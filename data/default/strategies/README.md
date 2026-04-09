# Yojin Trading Strategies

Community-authored trading strategies for Yojin. Each strategy is a Markdown file with YAML frontmatter that Yojin's Strategist agent reads as natural-language instructions.

## Strategies

| #  | Strategy                                                          | Style           | Asset Class | Requires                            | Trigger Type                         |
|----|-------------------------------------------------------------------|-----------------|-------------|-------------------------------------|--------------------------------------|
| 1  | [Price Momentum](price-momentum.md)                               | momentum        | Stocks      | market_data                         | PRICE_MOVE                           |
| 2  | [Earnings Momentum (SUE)](earnings-momentum.md)                   | event_driven    | Stocks      | fundamentals, market_data           | EARNINGS_PROXIMITY, METRIC_THRESHOLD |
| 3  | [Bollinger Mean-Reversion](bollinger-mean-reversion.md)           | mean_reversion  | Stocks      | market_data, technicals             | INDICATOR_THRESHOLD                  |
| 4  | [RSI Divergence](rsi-divergence.md)                               | technical       | Stocks      | technicals, market_data             | INDICATOR_THRESHOLD                  |
| 5  | [Multi-Factor Ranking](multi-factor-ranking.md)                   | quant           | Stocks      | fundamentals, technicals, sentiment | CUSTOM                               |
| 6  | [Pairs Trading](pairs-trading.md)                                 | statistical_arb | Stocks      | market_data                         | CUSTOM                               |
| 7  | [Sector Rotation](sector-rotation.md)                             | momentum        | ETFs        | market_data, portfolio              | PRICE_MOVE                           |
| 8  | [Covered Call](covered-call.md)                                   | income          | Options     | market_data, derivatives            | INDICATOR_THRESHOLD                  |
| 9  | [Carry Trade](carry-trade.md)                                     | carry           | FX          | macro_data                          | CUSTOM                               |
| 10 | [Sentiment-Based (Naive Bayes)](sentiment-naive-bayes.md)         | sentiment       | Crypto      | sentiment                           | METRIC_THRESHOLD                     |
| 11 | [Book-to-Price Value](book-to-price-value.md)                     | value           | Stocks      | fundamentals                        | METRIC_THRESHOLD                     |
| 12 | [Volatility Risk Premium](volatility-risk-premium.md)             | income          | Stocks/ETFs | technicals, market_data             | INDICATOR_THRESHOLD                  |
| 13 | [News Momentum](news-momentum.md)                                 | event_driven    | Stocks      | news, sentiment                     | SIGNAL_PRESENT                       |
| 14 | [Drawdown Mean-Reversion](drawdown-mean-reversion.md)             | mean_reversion  | Stocks      | market_data, technicals             | DRAWDOWN                             |
| 15 | [Concentration Drift Rebalance](concentration-drift-rebalance.md) | risk            | Portfolio   | portfolio                           | CONCENTRATION_DRIFT                  |

## How It Works

1. **Import** a strategy into Yojin via the web UI (paste Markdown or fetch from URL)
2. **Activate** the strategy on the Skills page or through the Strategist agent
3. **Yojin evaluates** trigger conditions against your portfolio data
4. **When triggers fire**, the Strategist reads the strategy content and proposes actions in the Intel Feed

Strategies are Markdown files with structured YAML frontmatter. The frontmatter defines machine-readable trigger conditions and metadata. The body is free-form Markdown that the Strategist agent reads as natural-language instructions for thesis, entry/exit rules, and risk controls.

## Writing a Strategy

A good strategy file has:

- **Clear frontmatter** with accurate trigger conditions and data requirements
- **Thesis section** explaining why the strategy works, with academic or empirical backing
- **Entry rules** that are specific and unambiguous
- **Exit rules** covering both profit-taking and stop-loss scenarios
- **Risk controls** with concrete position limits, sector caps, and timing restrictions

Use the existing strategies as templates. The Strategist agent interprets the Markdown body as instructions, so write as if you're explaining the strategy to a knowledgeable trader.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full format spec and submission guidelines.

## Attribution

The seed strategies in this collection are inspired by concepts described in *151 Trading Strategies* by Zura Kakushadze and Juan Andrés Serur (2018). The strategy descriptions here are original works that adapt well-established academic concepts for use with Yojin's agent system. They do not reproduce text from the paper. The underlying trading strategies (momentum, value, mean-reversion, etc.) are widely documented in the financial literature and are not proprietary to any single publication.

Reference: Kakushadze, Z. and Serur, J.A. (2018). *151 Trading Strategies*. Available at SSRN: <https://ssrn.com/abstract=3247865>

## Disclaimer

These strategies are provided for informational and educational purposes only. They do not constitute investment advice, recommendations, or solicitations to buy or sell any securities. Past performance of any strategy does not guarantee future results. Trading involves risk of loss. Always conduct your own research and consult a qualified financial advisor before making investment decisions.
