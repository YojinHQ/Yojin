---
name: News Momentum
description: Trade directional moves following high-impact news events, capturing the post-news drift before the market fully prices the information
category: MARKET
style: event_driven
requires:
  - news
  - sentiment
triggers:
  - type: SIGNAL_PRESENT
    description: Recent NEWS or FILINGS signal with bullish sentiment polarity
    params:
      signal_types:
        - NEWS
        - FILINGS
      min_sentiment: 0.3
      lookback_hours: 24
tickers: []
maxPositionSize: 0.03
---

# News Momentum

## Thesis

Information diffuses into stock prices gradually, not instantaneously. Tetlock (2007) showed that the fraction of negative words in Wall Street Journal columns predicts next-day market returns and high trading volume, with linguistic tone explaining returns beyond what quantitative news content captures. Chan (2003) documented that stocks with identifiable news events exhibit momentum over 1-12 months, while stocks that move on no news tend to reverse — implying that news-driven moves carry genuine information.

The post-news drift is a close cousin of post-earnings announcement drift (PEAD) but applies to a broader set of corporate events: management changes, product launches, regulatory decisions, contract wins, and M&A activity. Engelberg, McLean & Pontiff (2018) found that anomaly returns are concentrated on news days, suggesting that mispricing corrects when new information forces attention.

The strategy evaluates signals within a 24-hour lookback window — matching the skill evaluator's pre-fetched signal cache. This captures the bulk of the post-news drift without requiring sub-hour reaction times that retail investors cannot reliably sustain.

## Entry Rules

1. Monitor the signal archive for recent `NEWS` or `FILINGS` signals on portfolio tickers published within the last 24 hours.
2. Assess directional impact: the signal's numeric `sentimentScore` must be ≥ 0.3 (bullish). This strategy is long-only — negative-sentiment signals are handled as exits or avoidance, not short entries (see Risk Controls).
3. Confirm that the news is genuinely new (not a rehash of prior information) by checking against the signal archive for duplicates in the past 48 hours.
4. **Long entry**: Bullish signal + stock up > 1% from pre-news price + above-average volume in the first 30 minutes of the post-news session.
5. **Exit signal for existing longs**: A bearish news signal (negative `sentimentScore`) on a held position.
6. Act on signals while they remain within the 24-hour lookback window. Signals older than 24 hours are not evaluated.
7. Require market cap > $2B (smaller stocks may gap on illiquidity rather than information).
8. Skip news during the first and last 15 minutes of the trading day (noisy, wide spreads).

## Exit Rules

1. **Time-based exit**: Close position within 5 trading days. News drift is a short-duration effect.
2. **Profit target**: Take profit at 4% gain from entry.
3. **Stop-loss**: Exit at 2% loss from entry. A failed news move often reverses quickly.
4. **Reversal signal**: Exit if a contradicting high-relevance news signal appears for the same stock.
5. **Volume fade**: Exit if trading volume drops below the 10-day average on the day after entry (move lacks follow-through).

## Risk Controls

- Maximum position size: 3% of portfolio NAV (event-driven trades carry headline risk).
- Maximum concurrent news-driven positions: 4.
- No more than 1 position per stock per week (avoid over-trading on follow-up articles about the same event).
- Avoid entering on news about regulatory actions, litigation, or FDA decisions — these have binary, unpredictable outcomes that don't exhibit clean drift.
- Do not trade against the broad market trend: skip bullish news entries when S&P 500 is below its 20-day moving average, and vice versa.
- Factor in the bid-ask spread: skip trades where the spread exceeds 0.3% of price.
