/**
 * Extended Jintel types — fields the API returns but aren't yet in the
 * published @yojinhq/jintel-client@0.2.x package types.
 *
 * Remove once the upstream package ships these definitions.
 */

import type { EnrichmentField, Entity } from '@yojinhq/jintel-client';

export interface Technicals {
  rsi?: number | null;
  macd?: { macd: number; signal: number; histogram: number } | null;
  bollingerBands?: { lower: number; middle: number; upper: number } | null;
  ema?: number | null;
  sma?: number | null;
  atr?: number | null;
  vwma?: number | null;
  mfi?: number | null;
}

export interface NewsArticle {
  source: string;
  title: string;
  date: string;
  snippet?: string;
  link?: string;
}

export interface ResearchItem {
  title: string;
  author?: string;
  publishedDate?: string;
  url?: string;
}

/** Entity with fields the API returns but the published types omit. */
export type ExtendedEntity = Entity & {
  technicals?: Technicals | null;
  news?: NewsArticle[] | null;
  research?: ResearchItem[] | null;
};

/** Enrichment fields including those not yet in the published type. */
export type ExtendedEnrichmentField = EnrichmentField | 'technicals' | 'news' | 'research';
