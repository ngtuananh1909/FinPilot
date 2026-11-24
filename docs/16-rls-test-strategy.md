# 16 · RLS and Repository Adversarial Test Strategy

Status (T01.4): the repository layer and its fake-based tests exist. **No database behaviour has been verified.**
The hardening migration (`supabase/proposed/202611230002_finpilot_hardening.sql`) is not applied and no remote project was contacted.

## Defence layers

| # | Layer | What it protects | Where | State |
|---|---|---|---|---|
| 1 | Verified identity | Owner id comes only from `auth.getUser()`; `OwnerContext` is a unique-symbol branded type issued by one factory, registered in a WeakSet at runtime | `src/lib/auth/owner-context.ts` | Unit tested |
| 2 | Input schemas (zod `.strict()`) | Rejects `user_id`/`userId`/`owner` keys, bad amounts/dates, half recurring links, `source: 'seed'`, profile server fields | `src/lib/db/inputs.ts` | Unit tested |
| 3 | Explicit query scoping | Every query has `.eq('user_id', owner.userId)`; inserts/upserts set `user_id` from the context; id-based update/delete add the owner filter | `src/lib/db/repositories/*` | Unit tested with recording fakes |
| 4 | Filter hygiene | Search text reduced to `[\p{L}\p{N} .'-]` before entering the `or=(...)` expression; category regex; bounded pagination | `inputs.ts`, `transactions.ts` | Unit + property tested |
| 5 | Row validation at the boundary | Malformed DB rows become `DbError(db_row_invalid)`; bigint parsed by `parseDbVnd` | `mappers.ts`, `money.ts` | Unit tested |
| 6 | Static SQL review | Policies, grants, function ACLs, constraints in the SQL text | `tests/db/sql-static.test.ts` | Passing (text only) |
| 7 | RLS in PostgreSQL | Owner isolation even if layers 1-5 fail | `tests/db/rls.live.test.ts` | **Written, skipped, blocked until G2** |
| 8 | Privileged RPC wrappers | Quota/reset/bootstrap through the service role only after verified owner; fail closed with `rpc_unavailable` | `src/lib/db/repositories/server-only/*` | Unit tested against a model of the SQL, not the SQL |

Layer 3 is defence in depth. It does not replace layer 7. If RLS were disabled, layer 3 would still scope reads, but nothing in this repo proves RLS works until layer 7 runs.

## Attack coverage

| Attack | Covered by | Verified how |
|---|---|---|
| Forge an owner from a string or object literal | `owner-context.test.ts` (`@ts-expect-error`, runtime forged cast, copied context) | Type check + unit |
| Call the factory from route code | `owner-context.test.ts` static scan (only `src/lib/auth` may call it) | Static |
| Non-UUID or mismatched id in the factory | `owner-context.test.ts` | Unit |
| Repository imports the admin client | `owner-context.test.ts` static scan | Static |
| `user_id` in request/tool input (create, update, list, goal, profile, batch, proposal, reset, bootstrap) | `inputs.test.ts`, `repositories.test.ts` ("owner injection"), `server-only-rpc.test.ts` | Unit; asserts zero queries issued |
| Row id used as owner (`id,user_id.eq.other`) | `repositories.test.ts` (uuid-only ids) | Unit |
| Read/write another user's row through a missing filter | `repositories.test.ts` (every operation has the owner filter or owner payload; other id never appears) | Unit with fakes |
| PostgREST filter injection via search (`%`, `,`, `)`, `or=`, quotes, `\`, `*`) | `inputs.test.ts` (table + fast-check), `repositories.test.ts` (shape of the `or` expression) | Unit + property |
| Injection via `category` | `inputs.test.ts`, `repositories.test.ts` | Unit |
| Oversized page / negative offset | `inputs.test.ts` (clamps, property), `repositories.test.ts` (range 0..200) | Unit + property |
| Money overflow, NaN, fractions, exponent, leading zero | `money.test.ts`, `inputs.test.ts` | Unit + property |
| Feb 30 / host-timezone date drift | `inputs.test.ts`, `mappers.test.ts` (runs under `TZ=America/New_York`) | Unit |
| Half recurring link | `inputs.test.ts`, `repositories.test.ts` | Unit (DB check constraint unverified) |
| Delete a recurring item that transactions reference | `repositories.test.ts` (`deleteRecurringItem` throws, no query; no `.delete(` in the module) | Unit + static |
| Malformed or hostile DB row | `mappers.test.ts` (20 cases, no leak of values/stack/cause) | Unit |
| Database error text leaking row data | `repositories.test.ts`, `server-only-rpc.test.ts`, `load-inputs.test.ts` | Unit |
| Quota exceeded, concurrency, double release, release after commit, other owner's release | `server-only-quota.test.ts` | Unit against `FakeQuotaDb` (model of the SQL) |
| Ambiguous timeout refunded by mistake | `server-only-quota.test.ts` (no release, no retry) | Unit |
| RPC missing treated as success | `server-only-quota.test.ts`, `server-only-rpc.test.ts` (`rpc_unavailable`) | Unit |
| Privileged wrapper run in a browser | `server-only-quota.test.ts` (`window` defined -> `server_only`) | Unit |
| Silent truncation of forecast inputs | `load-inputs.test.ts` (`truncated`, `balanceReliable`) | Unit |

## Unverified until a G2-approved target exists

- That RLS policies actually deny cross-user select/insert/update/delete, including anonymous users (role `authenticated`).
- That `anon` and `authenticated` cannot execute the RPCs, and that `service_role` can.
- That `reserve_ai_quota` is atomic under concurrency in PostgreSQL. `FakeQuotaDb` is a model written from the SQL text and only exercises the wrapper's call order.
- That `recurring_instance_pair_check`, the NO ACTION recurring FK, and the unique posting index reject what the TypeScript layer assumes.
- That hand-written `src/lib/db/schema.ts` matches the real columns (regenerate and diff at G2).
- That PostgREST returns `bigint` as JSON numbers and `timestamptz` as `+00:00` strings in the form the mappers accept.
- That `.or('merchant.ilike.%x%,...')` behaves as expected for the whitelisted characters (apostrophe, dot, hyphen) on the hosted PostgREST version.
- That PostgREST reports a missing RPC with `PGRST202` / 404 as `isMissingFunctionError` assumes.
- Performance and index use for `loadFinanceInputs` (5 pages of 1000 rows at most).

## Adding a repository function

1. Take `(client, owner: OwnerContext, ...)` and call `ownerIdOf(owner)` first.
2. Validate input with a `.strict()` schema through `parseInput`; validate ids with `rowId`.
3. Add `.eq('user_id', userId)` to the query, or set `user_id` from the context in the payload.
4. Map rows with a mapper that validates shape; never return raw rows.
5. Add the function to the `operations` table in `tests/db/repositories/repositories.test.ts`.

## Running

```bash
npx vitest run tests/db/repositories     # fake-based suite, offline
npm test                                  # everything; live RLS tests stay skipped
```
