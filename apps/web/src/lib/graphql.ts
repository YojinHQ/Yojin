import { Client, cacheExchange, fetchExchange } from 'urql';

export const graphqlClient = new Client({
  url: import.meta.env.VITE_GRAPHQL_URL ?? '/graphql',
  exchanges: [cacheExchange, fetchExchange],
});
