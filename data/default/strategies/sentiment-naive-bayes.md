---
name: Social Sentiment Momentum
description: Trade crypto assets based on social media sentiment momentum using aggregated mention velocity and sentiment scores
category: RESEARCH
style: sentiment
requires:
  - sentiment
triggers:
  - type: METRIC_THRESHOLD
    description: 24h social mention volume momentum exceeds 20%
    params:
      metric: sentiment_momentum_24h
      threshold: 0.20
      direction: above
tickers: []
maxPositionSize: 0.03
---

# Social Sentiment Momentum

## Thesis

Naive Bayes text classification can extract directional trading signals from social media text. Following the approach in Kakushadze (2018, Section 18.3), the strategy constructs a keyword vocabulary V from financial social media (Twitter/X, Reddit, Telegram), represents each post as a Bernoulli feature vector (Xia = 1 if word a from V is present in document i), and applies Bayes' theorem with naive conditional independence to classify posts into K directional classes: bullish, bearish, or neutral. The posterior probability P(class | features) provides both a classification and a confidence measure.

NB is well-suited to this domain because it handles high-dimensional sparse text features efficiently, requires relatively little training data, and produces interpretable class probabilities. Abraham, Higdon-Topaz & Shank (2018) showed that Twitter sentiment polarity predicts next-day Bitcoin price direction with accuracy exceeding random walk benchmarks. Bollen, Mao & Zeng (2011) demonstrated that aggregate mood indicators from Twitter predict DJIA direction with 87.6% accuracy.

In cryptocurrency markets, where information asymmetries are larger and traditional fundamental analysis is less applicable, text-derived sentiment signals carry outsized importance. Kristoufek (2013) found that Bitcoin price dynamics are significantly influenced by collective attention and sentiment. The strategy aggregates NB classification outputs across posts over a 24-hour rolling window to produce a sentiment momentum signal, and can complement its own classifications with pre-computed sentiment scores from data providers (e.g., Jintel social sentiment) as additional features or cross-validation.

## Signal Construction

1. **Text collection**: Gather social media posts mentioning each tracked crypto asset from at least 2 independent sources (Twitter/X, Reddit, Telegram) over a rolling 24-hour window. Require at least 500 mentions for statistical significance.
2. **Feature extraction**: Maintain a keyword vocabulary V of sentiment-bearing financial terms. For each post, construct a Bernoulli feature vector where Xia = 1 if word a appears in the post.
3. **NB classification**: Classify each post into bullish / bearish / neutral using a trained Naive Bayes model. The model computes posterior class probabilities via Bayes' theorem assuming conditional independence of word features.
4. **Aggregation**: Compute the 24-hour sentiment momentum as the net shift in the bullish-minus-bearish classification ratio over the window. Pre-computed sentiment scores from Jintel (social rank, mention velocity, sentiment polarity) serve as complementary inputs and cross-validation for the NB output.
5. **Signal generation**: Trigger when the aggregated sentiment momentum exceeds +20% (bullish) or falls below -20% (bearish).

## Entry Rules

1. Trigger when the NB-derived sentiment momentum signal exceeds +20% (bullish) or falls below -20% (bearish short candidate).
2. For long entries: confirm with positive price action over the prior 4 hours (sentiment leading price, not lagging).
3. For short entries: confirm with negative price action and rising trading volume.
4. Enter within 2 hours of signal generation — sentiment signals decay rapidly.
5. Cross-reference the NB classification output with Jintel social sentiment scores to filter out signals where the two disagree.

## Exit Rules

1. **Time-based exit**: Close position within 24-48 hours. Sentiment-driven moves are short-lived.
2. **Sentiment reversal**: Exit if 24-hour sentiment momentum reverses sign (crosses zero).
3. **Profit target**: Take profit at 5% gain from entry.
4. **Stop-loss**: Exit at 3% loss from entry (tight stop given the speculative nature).
5. **Volume confirmation loss**: Exit if trading volume drops below the 7-day average within 6 hours of entry (move lacks institutional follow-through).

## Risk Controls

- Maximum position size: 3% of portfolio NAV (high-volatility asset class).
- Maximum concurrent sentiment-driven positions: 3.
- No more than 10% of portfolio in sentiment-based crypto trades at any time.
- Avoid entering during weekends when liquidity is thinner and manipulation risk is higher.
- Filter out sentiment spikes driven by single viral posts or known manipulation patterns (e.g., coordinated pump groups).
- Require a 4-hour cooldown between closing and re-entering the same asset on a new signal.
