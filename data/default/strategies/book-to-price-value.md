---
name: Book-to-Price Value
description: Buy stocks trading at low price-to-book multiples — captures the value premium with a hard P/B threshold
category: MARKET
style: value
requires:
  - fundamentals
triggers:
  - type: METRIC_THRESHOLD
    description: Stock trades below 1.5x book value
    params:
      metric: priceToBook
      threshold: 1.5
      direction: below
tickers: []
maxPositionSize: 0.05
---

# Book-to-Price Value

## Thesis

The value premium — the tendency of high book-to-market (HML) stocks to outperform low book-to-market stocks — is one of the most robust factors in asset pricing. Fama & French (1992) documented that HML earns 4-6% annually in the US, and their three-factor model (1993) established book-to-market as a priced risk factor alongside size and market beta. The premium has been confirmed across international markets (Fama & French, 1998) and persists over extended time periods.

Behavioral explanations argue that investors systematically overreact to poor past performance, pushing value stocks below fair value (Lakonishok, Shleifer & Vishny, 1994). Risk-based explanations contend that value stocks are genuinely riskier — they tend to be distressed firms with higher financial leverage and operating risk (Fama & French, 1995). The strategy agnostically harvests the premium while using quality filters to avoid "value traps" — deeply discounted stocks that deserve their low valuations.

The quality filter (positive trailing earnings) follows Novy-Marx (2013), who showed that combining value with quality (profitability) substantially improves the strategy's risk-adjusted returns. Piotroski (2000) demonstrated that simple accounting screens can separate winners from losers within the value quintile.

Note: this implementation uses a hard scalar P/B threshold (≤1.5x) rather than the cross-sectional decile or quintile sorts common in the academic literature. Cross-sectional ranking against a sector benchmark requires a 100+ stock universe and benchmark sector medians — neither of which fits a 20-position retail portfolio. The scalar threshold is a practical adaptation: it fires for any held position whose price-to-book multiple is below 1.5x, and the Strategist agent is left to assess sector-relative cheapness, value-trap risk, and quality filters from the markdown body when proposing actions.

## Entry Rules

1. Quarterly (after earnings season), compute book-to-price ratio (B/P = book value per share / market price) for all stocks in the investable universe.
2. Rank stocks by B/P within each GICS sector (sector-neutral ranking avoids persistent sector biases).
3. Select stocks in the top quintile of B/P within their sector.
4. Apply quality filters:
   - Positive trailing 12-month net income (exclude unprofitable firms).
   - Debt-to-equity ratio below the sector median (exclude over-leveraged firms).
   - Positive free cash flow in at least 2 of the past 4 quarters.
5. From the filtered set, equal-weight the top 15-20 stocks.
6. Require market cap > $1B and average daily volume > $2M.

## Exit Rules

1. **Quarterly rebalance**: Remove stocks that fall out of the top B/P quintile or fail quality filters at the quarterly review.
2. **Fundamental deterioration**: Exit immediately if trailing earnings turn negative between rebalances.
3. **Stop-loss**: Exit if position declines 25% from entry (wide stop — value stocks are inherently volatile and need room to work).
4. **Valuation target**: Exit if B/P ratio drops below the median for the sector (the stock has re-rated and is no longer "cheap").
5. **Holding period**: Minimum 1 quarter, maximum 2 years. Value is a slow-burn factor.

## Risk Controls

- Maximum position size: 5% of portfolio NAV.
- Minimum portfolio diversification: 15 positions when fully invested.
- Maximum sector weight: 25% (even with sector-neutral ranking, some sectors may dominate).
- Avoid financial sector stocks where book value is less meaningful (banks, insurance) unless using tangible book value.
- Limit overlap with other value-oriented strategies to 30% of holdings.
- Rebalance quarterly, not monthly — value is a low-turnover strategy. Annual turnover target: 40-60%.
