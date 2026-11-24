# 09 · Test Plan, Acceptance Criteria and Evidence

## Test levels
- **Pure unit tests:** balance snapshot, 45-day projection, end-of-month and leap dates, reserve checks, CSV parsing, fingerprinting, normalization, AI proposal schemas.
- **DB/RLS integration:** separate auth users; guest isolation; auth ownership, unique goal, same-user child FK; server quota atomicity; no unrestricted table access.
- **API integration:** auth failures, input validators, idempotency, import preview/commit, receipt validation, provider failures, approval lifecycle.
- **End-to-end browser:** mobile + desktop, welcome/persona → Dashboard → add transaction → Simulator → Chat tool call → Reset, plus email/password demo login.
- **Live smoke:** AWS Amplify publicly reachable, HTTPS and secrets configured, Supabase same project, real provider call and vision scan when user sets key.

## Requirement-oriented acceptance tests
| ID | Given / When / Then |
|---|---|
| AC-01 | Given Guest chooses persona, when session starts, then own data appears and no login required |
| AC-02 | Given Guest A and Guest B, when B changes a transaction, then A's data is unchanged |
| AC-03 | Given 3 demo email users, each can login and access only their own data |
| AC-04 | Given transaction before balance snapshot, saving it changes historic analytics but **not** current balance |
| AC-05 | Given post-snapshot expense, current balance decreases exactly once |
| AC-06 | Given CSV with invalid and suspected duplicate rows, preview clearly labels them; no writes until confirm |
| AC-07 | Given receipt image, extracted fields can be corrected; confirmed transaction saved exactly once |
| AC-08 | Given recurring item day 31, forecast clamps correctly in short/leap months |
| AC-09 | Given low data coverage, forecast falls back to supplied expected spending and labels uncertainty |
| AC-10 | Given purchase scenario with interim reserve breach but positive final balance, output marks unsafe |
| AC-11 | Given repeated identical simulation, outputs are deterministic |
| AC-12 | Given AI finance question, response includes actual authorized tool result/assumptions |
| AC-13 | Given model asks to change projected budget, record remains unchanged until explicit approval; stale/replayed approvals fail |
| AC-14 | Given Guest hits 20 chat or 5 scans in VN calendar day, next request blocked server-side with clear UI |
| AC-15 | Given no API key or an unsupported model, app shows error rather than fake AI success; non-AI pages remain usable |
| AC-16 | Given owner A token, cannot query owner B data directly through Supabase or app API |
| AC-17 | Given mobile viewport 375px, all five routes and main actions work with no horizontal scroll |
| AC-18 | Given approved main push, public Amplify app loads and judge demo needs no developer laptop |

## Required evidence for agent handoff
- Exact command and result of lint, typecheck, test suite and production build.
- Test case matrix with pass/fail/blocked and steps to reproduce.
- Screenshots or screen recording of mobile and desktop relevant flows.
- Proof of tool-call integration: sanitized tool name, parameters and typed result (no secrets/PII).
- RLS isolation test outputs for at least two distinct users, ideally 3 personas and 3 login accounts.
- Deployment URL and smoke-test outputs **only after authorized deployment**.

## Test data discipline
Use synthetic fixture personas only. On **shared Supabase DB**, do not run broad cleanup. Local tests should mock DB or use pure functions; hosted integration uses designated throwaway user and approved scoped cleanup. Do not claim integration tests passed if no safe environment/authorization is available: mark blocked with cause and next step.

## Review gates
After each task: static checks/tests and code review; after each feature: cross-page E2E; before any remote migration/deploy: explicit user permission; before release: final acceptance review and documentation check. The final release approval is distinct from product spec approval.
