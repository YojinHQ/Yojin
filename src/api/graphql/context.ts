/**
 * GraphQL context builder.
 *
 * For now the context is minimal. Once the full YojinContext composition root
 * is available, it will be injected here so resolvers can access data sources,
 * sessions, agents, and the trust layer.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- will be populated with YojinContext later
export interface GraphQLContext {}

export function buildContext(): GraphQLContext {
  return {};
}
