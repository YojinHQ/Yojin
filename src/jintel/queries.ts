import type { EnrichmentField } from './types.js';

// ── Field Fragments ────────────────────────────────────────────────────────

export const MARKET_QUOTE_FIELDS = `
  quote {
    ticker
    price
    open
    high
    low
    previousClose
    change
    changePercent
    volume
    marketCap
    timestamp
    source
  }`;

export const FUNDAMENTALS_FIELDS = `
  fundamentals {
    marketCap
    revenue
    netIncome
    eps
    peRatio
    dividendYield
    beta
    fiftyTwoWeekHigh
    fiftyTwoWeekLow
    debtToEquity
    sector
    industry
    source
  }`;

export const NEWS_FIELDS = `
  news(limit: 10) {
    title
    url
    source
    publishedAt
    snippet
    sentiment
  }`;

export const RISK_FIELDS = `
  risk {
    overallScore
    signals {
      type
      severity
      description
      source
      date
    }
    sanctionsHits
    adverseMediaHits
    regulatoryActions
  }`;

export const REGULATORY_FIELDS = `
  regulatory {
    sanctions {
      listName
      matchedName
      score
      details
    }
    filings {
      type
      date
      url
      description
    }
  }`;

export const CORPORATE_FIELDS = `
  corporate {
    legalName
    jurisdiction
    incorporationDate
    status
    officers {
      name
      role
      appointedDate
    }
    registeredAddress
  }`;

// ── Static Queries ─────────────────────────────────────────────────────────

export const SEARCH_ENTITIES = `
  query SearchEntities($query: String!, $type: EntityType, $limit: Int) {
    searchEntities(query: $query, type: $type, limit: $limit) {
      id
      name
      type
      tickers
      domain
      country
    }
  }`;

export const BATCH_QUOTES = `
  query BatchQuotes($tickers: [String!]!) {
    batchQuotes(tickers: $tickers) {
      ticker
      price
      open
      high
      low
      previousClose
      change
      changePercent
      volume
      marketCap
      timestamp
      source
    }
  }`;

export const NEWS_SEARCH = `
  query NewsSearch($query: String!, $limit: Int) {
    newsSearch(query: $query, limit: $limit) {
      title
      url
      source
      publishedAt
      snippet
      sentiment
    }
  }`;

export const SANCTIONS_SCREEN = `
  query SanctionsScreen($name: String!, $country: String) {
    sanctionsScreen(name: $name, country: $country) {
      listName
      matchedName
      score
      details
    }
  }`;

export const WEB_SEARCH = `
  query WebSearch($query: String!, $limit: Int) {
    webSearch(query: $query, limit: $limit) {
      title
      url
      snippet
      source
      publishedAt
    }
  }`;

// ── Dynamic Query Builder ──────────────────────────────────────────────────

const FIELD_BLOCK_MAP: Record<EnrichmentField, string> = {
  market: `market {\n    ${MARKET_QUOTE_FIELDS.trim()}\n    ${FUNDAMENTALS_FIELDS.trim()}\n  }`,
  news: NEWS_FIELDS.trim(),
  risk: RISK_FIELDS.trim(),
  regulatory: REGULATORY_FIELDS.trim(),
  corporate: CORPORATE_FIELDS.trim(),
};

export function buildEnrichQuery(fields: EnrichmentField[]): string {
  const blocks = fields
    .filter((f) => f in FIELD_BLOCK_MAP)
    .map((f) => `    ${FIELD_BLOCK_MAP[f]}`)
    .join('\n');

  return `
  query EnrichEntity($id: ID!) {
    entity(id: $id) {
      id
      name
      type
      tickers
      domain
      country
${blocks}
    }
  }`;
}
