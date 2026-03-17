/**
 * GraphQL schema definition (SDL-first) for the Yojin API.
 *
 * Covers portfolio, enrichment, risk, alerts, agent status, and brain state.
 * Subscriptions are defined for real-time updates (portfolio, alerts, agent activity).
 */

export const typeDefs = /* GraphQL */ `
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

  type Portfolio {
    totalValue: Float!
    dayChange: Float!
    dayChangePercent: Float!
    positions: [Position!]!
    lastUpdated: String!
  }

  type Position {
    symbol: String!
    name: String!
    quantity: Float!
    currentPrice: Float!
    avgCost: Float!
    marketValue: Float!
    unrealizedPnl: Float!
    unrealizedPnlPercent: Float!
    dayChange: Float!
    dayChangePercent: Float!
    weight: Float!
    assetClass: String!
    sector: String
    platform: String!
  }

  type EnrichedSnapshot {
    positions: [EnrichedPosition!]!
    generatedAt: String!
  }

  type EnrichedPosition {
    symbol: String!
    sentiment: Sentiment
    fundamentals: Fundamentals
  }

  type Sentiment {
    score: Float!
    label: String!
    source: String!
    updatedAt: String!
  }

  type Fundamentals {
    marketCap: Float
    peRatio: Float
    eps: Float
    dividendYield: Float
    beta: Float
    fiftyTwoWeekHigh: Float
    fiftyTwoWeekLow: Float
  }

  type RiskReport {
    overallScore: Float!
    exposureBreakdown: ExposureBreakdown!
    concentrationScore: Float!
    topConcentrations: [ConcentrationEntry!]!
    correlatedPairs: [CorrelatedPair!]!
    generatedAt: String!
  }

  type ExposureBreakdown {
    bySector: [ExposureEntry!]!
    byAssetClass: [ExposureEntry!]!
    byGeography: [ExposureEntry!]!
  }

  type ExposureEntry {
    name: String!
    weight: Float!
    value: Float!
  }

  type ConcentrationEntry {
    symbol: String!
    weight: Float!
    risk: String!
  }

  type CorrelatedPair {
    symbolA: String!
    symbolB: String!
    correlation: Float!
  }

  type Alert {
    id: String!
    type: String!
    severity: String!
    message: String!
    symbol: String
    triggeredAt: String!
    acknowledged: Boolean!
  }

  type AgentStatus {
    id: String!
    name: String!
    role: String!
    status: String!
    lastActivity: String
    currentTask: String
  }

  type BrainState {
    persona: String!
    workingMemory: [String!]!
    emotionState: EmotionState!
    lastCommit: String
  }

  type EmotionState {
    confidence: Float!
    riskAppetite: Float!
    rationale: String!
  }

  type AgentEvent {
    agentId: String!
    type: String!
    message: String!
    timestamp: String!
  }
`;
