import { buildSchema, parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';

import { typeDefs } from '../../../src/api/graphql/schema.js';

describe('GraphQL schema', () => {
  it('builds without errors', () => {
    const schema = buildSchema(typeDefs);
    expect(schema).toBeDefined();
    expect(schema.getQueryType()).toBeDefined();
    expect(schema.getMutationType()).toBeDefined();
    expect(schema.getSubscriptionType()).toBeDefined();
  });

  it('has all expected query fields', () => {
    const schema = buildSchema(typeDefs);
    const queryType = schema.getQueryType()!;
    const fields = queryType.getFields();

    expect(fields.portfolio).toBeDefined();
    expect(fields.riskReport).toBeDefined();
    expect(fields.alerts).toBeDefined();
    expect(fields.news).toBeDefined();
    expect(fields.quote).toBeDefined();
  });

  it('has all expected mutation fields', () => {
    const schema = buildSchema(typeDefs);
    const mutationType = schema.getMutationType()!;
    const fields = mutationType.getFields();

    expect(fields.refreshPositions).toBeDefined();
    expect(fields.dismissAlert).toBeDefined();
  });

  it('has all expected subscription fields', () => {
    const schema = buildSchema(typeDefs);
    const subscriptionType = schema.getSubscriptionType()!;
    const fields = subscriptionType.getFields();

    expect(fields.onAlert).toBeDefined();
    expect(fields.onPortfolioUpdate).toBeDefined();
    expect(fields.onPriceMove).toBeDefined();
  });

  it('validates a portfolio query', () => {
    const schema = buildSchema(typeDefs);
    const doc = parse(`
      query {
        portfolio {
          id
          totalValue
          positions {
            symbol
            name
            currentPrice
            marketValue
          }
        }
      }
    `);
    const errors = validate(schema, doc);
    expect(errors).toHaveLength(0);
  });

  it('validates a quote query with argument', () => {
    const schema = buildSchema(typeDefs);
    const doc = parse(`
      query {
        quote(symbol: "AAPL") {
          symbol
          price
          change
          changePercent
        }
      }
    `);
    const errors = validate(schema, doc);
    expect(errors).toHaveLength(0);
  });

  it('validates a dismissAlert mutation', () => {
    const schema = buildSchema(typeDefs);
    const doc = parse(`
      mutation {
        dismissAlert(id: "alert-123") {
          id
          status
          thesis
        }
      }
    `);
    const errors = validate(schema, doc);
    expect(errors).toHaveLength(0);
  });
});
