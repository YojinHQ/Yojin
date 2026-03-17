/**
 * GraphQL API entry point — exports schema, resolvers, and the yoga server factory.
 *
 * Usage:
 *   import { createGraphQLServer } from './graphql/index.js';
 *   const yoga = createGraphQLServer();
 *   // Mount yoga on a Hono route
 */

import { createSchema, createYoga } from 'graphql-yoga';

import { typeDefs } from './schema.js';
import { resolvers } from './resolvers/index.js';
import { buildContext } from './context.js';
import type { GraphQLContext } from './context.js';

export type { GraphQLContext } from './context.js';

/**
 * Create a graphql-yoga instance configured with the Yojin schema and resolvers.
 * The returned yoga instance is a standard fetch-compatible handler that can be
 * mounted on any HTTP framework (Hono, Express, etc.).
 */
export function createGraphQLServer() {
  const schema = createSchema<GraphQLContext>({
    typeDefs,
    resolvers,
  });

  const yoga = createYoga<GraphQLContext>({
    schema,
    context: () => buildContext(),
    graphqlEndpoint: '/graphql',
    landingPage: true,
  });

  return yoga;
}

export { typeDefs } from './schema.js';
export { resolvers } from './resolvers/index.js';
