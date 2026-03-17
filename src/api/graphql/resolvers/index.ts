/**
 * Merged resolvers — combines all domain-specific resolver maps into a single
 * resolver object for graphql-yoga.
 *
 * Uses a simple deep merge: each resolver file exports a { Query: { ... } } map,
 * and we merge all Query fields together. Subscription resolvers are handled
 * similarly when real-time data sources are wired up.
 */

import { portfolioResolvers } from './portfolio.js';
import { enrichmentResolvers } from './enrichment.js';
import { riskResolvers } from './risk.js';
import { alertsResolvers } from './alerts.js';
import { agentResolvers } from './agents.js';

type ResolverMap = Record<string, Record<string, unknown>>;

/**
 * Deep-merge resolver maps. Each resolver file contributes fields under
 * shared root types (Query, Mutation, Subscription). Fields within the same
 * root type are merged; conflicts are last-write-wins.
 */
function mergeResolvers(...maps: ResolverMap[]): ResolverMap {
  const merged: ResolverMap = {};

  for (const map of maps) {
    for (const [typeName, fields] of Object.entries(map)) {
      if (!merged[typeName]) {
        merged[typeName] = {};
      }
      Object.assign(merged[typeName], fields);
    }
  }

  return merged;
}

export const resolvers = mergeResolvers(
  portfolioResolvers,
  enrichmentResolvers,
  riskResolvers,
  alertsResolvers,
  agentResolvers,
);
