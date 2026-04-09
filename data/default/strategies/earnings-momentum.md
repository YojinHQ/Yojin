---
name: Earnings Momentum
description: Exploit post-earnings announcement drift by entering after positive earnings surprises with SUE > 2.0
category: MARKET
style: event_driven
requires:
  - fundamentals
  - market_data
triggers:
  - type: EARNINGS_PROXIMITY
    description: Stock is within 3 trading days of earnings announcement
    params:
      days: 3
  - type: METRIC_THRESHOLD
    description: Standardized unexpected earnings (SUE) above 2.0 — last quarter's surprise normalized by the sample stddev of available quarterly surprises (minimum 2)
    params:
      metric: SUE
      threshold: 2.0
      direction: above
tickers: []
maxPositionSize: 0.03
---

# Earnings Momentum

## Thesis

Post-earnings announcement drift (PEAD) is among the oldest and most persistent market anomalies. Ball & Brown (1968) first documented that stocks with positive earnings surprises continue to drift upward for 60-90 days after the announcement. Bernard & Thomas (1989, 1990) formalized the effect using standardized unexpected earnings (SUE) and showed that a long-short strategy based on extreme SUE deciles earns 4-8% per quarter.

The anomaly persists because investors systematically underreact to earnings news — anchoring to prior expectations and updating beliefs too slowly (Barberis, Shleifer & Vishny, 1998). Institutional constraints (index tracking, position limits) also delay the full price adjustment. Livnat & Mendenhall (2006) confirmed PEAD remains profitable even after transaction costs using analyst-based surprise measures.

The strategy uses SUE > 2.0 as the entry threshold, corresponding to earnings that beat consensus by more than 2 standard deviations of historical surprises. This high bar filters for genuinely informative surprises rather than noise.

## Entry Rules

1. Monitor earnings announcements daily. Flag stocks reporting within 3 trading days.
2. After announcement, compute SUE = (Current Quarter EPS - Same Quarter Prior Year EPS) / Std Dev of unexpected earnings over the last 8 quarters (seasonal random walk model per Bernard & Thomas, 1989).
3. Enter long if SUE > 2.0 and the stock shows positive price reaction on the announcement day (confirmation).
4. Enter within 1 trading day of announcement to capture the early drift phase.
5. Require market cap > $1B and average daily volume > $2M.
6. Skip biotech/pharma earnings (binary outcomes dominated by pipeline news, not operating performance).

## Exit Rules

1. **Time-based exit**: Close position 60 trading days after entry (drift largely exhausted by this point).
2. **Profit target**: Exit if position gains 12% from entry within the holding period.
3. **Stop-loss**: Exit if position declines 5% from entry price within the first 5 days (failed drift signal).
4. **Trailing stop**: After day 5, use a 8% trailing stop from peak price.
5. **Pre-earnings exit**: Close before the next quarterly earnings to avoid compounding event risk.

## Risk Controls

- Maximum position size: 3% of portfolio NAV (earnings events carry gap risk).
- Maximum concurrent earnings plays: 5 positions.
- No more than 2 positions in the same GICS sector.
- Avoid entering during broad market sell-offs (S&P 500 below its 50-day moving average).
- Skip stocks with abnormally high short interest (> 15% of float) as squeeze dynamics obscure the drift signal.
- Account for bid-ask spread: skip illiquid names where round-trip cost exceeds 0.5%.
