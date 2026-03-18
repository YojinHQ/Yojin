import { Client, cacheExchange, fetchExchange, subscriptionExchange } from 'urql';
import { createClient as createSSEClient } from 'graphql-sse';

const graphqlUrl = (import.meta.env.VITE_GRAPHQL_URL as string | undefined) ?? '/graphql';

const sseClient = createSSEClient({
  url: graphqlUrl,
});

export const graphqlClient = new Client({
  url: graphqlUrl,
  exchanges: [
    cacheExchange,
    fetchExchange,
    subscriptionExchange({
      forwardSubscription(request) {
        return {
          subscribe(sink) {
            const unsubscribe = sseClient.subscribe({ ...request, query: request.query ?? '' }, sink);
            return { unsubscribe };
          },
        };
      },
    }),
  ],
});
