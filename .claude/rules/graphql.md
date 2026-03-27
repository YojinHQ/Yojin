# GraphQL Schema Rules

## Enums over Strings
When a field has a fixed set of known values (especially if a Zod schema already defines them), use a GraphQL `enum`, not `String`. Enums give clients compile-time validation, enable autocomplete, and make the schema self-documenting. Reserve `String` for truly open-ended values (e.g. `platform` which supports user-defined custom platforms).

## ID! for Identifiers
Fields that uniquely identify an entity (primary keys, foreign keys used for lookups) must use `ID!`, not `String!`. This communicates semantic intent — clients and caching layers (like urql graphcache) treat `ID` fields as opaque identifiers, not arbitrary text.

## No Dead Types
Every type in the schema must be reachable from `Query`, `Mutation`, or `Subscription`. If a type has no backing resolver or is no longer used by any client, remove it. Dead types mislead consumers and accumulate stale client-side code (fragments, hooks, cache keys).

## Schema ↔ Resolver Type Parity
When the schema uses an enum for a field, the corresponding resolver GQL interface must use the same TypeScript enum/union type — not `string`. If the domain type uses `string`, cast it in the `toGql` mapper. This keeps the resolver layer honest about what it returns.

## Cache Key Registration
When adding a new type to the schema, register it in `apps/web/src/lib/graphql.ts` cache keys:
- Types with a unique `id` field: use `(data) => data.id as string`
- Embedded/value types (no stable identity): use `() => null`
- Types keyed by composite fields: use a custom key function

Forgetting this causes graphcache to silently merge unrelated objects.

## Schema Change Checklist
When modifying the schema:
1. Update `src/api/graphql/schema.ts` (SDL)
2. Update resolver type interfaces to match
3. Update `apps/web/src/api/types.ts` (client types)
4. Update `apps/web/src/api/documents.ts` if query/mutation signatures changed
5. Update cache keys in `apps/web/src/lib/graphql.ts` if new types added
6. Run `pnpm typecheck && pnpm --filter web typecheck && pnpm test`

## Wire Compatibility
`ID!` and `String!` serialize identically over JSON — switching between them is a non-breaking change for existing clients. GraphQL enums serialize as bare strings — switching `String` → `enum` is also non-breaking as long as existing values match the enum members.
