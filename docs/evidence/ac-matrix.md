# Acceptance matrix AC-01 … AC-18 (evidence as of 2026-11-24)

Legend: **PASS** = verified by the cited run; **PARTIAL** = verified locally or with fakes, live step still missing; **BLOCKED** = cannot be verified until the named owner action.

Commands and results of the final run:

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (0 errors, 0 warnings) |
| `npm test` | 93 files passed, 2 skipped; **1800 tests passed**, 38 skipped (the 38 are the live suites, run separately below) |
| `npm run test:coverage` (finance engine) | 96.9 % statements, 90.3 % branches |
| `npm run build` | pass (Next.js 15.5.29) |
| `npm run test:rls` (live, project `llrxhefrqnjdwlmxozul`) | **38/38 passed**; post-run read-only counts 0 users / 0 rows |
| `npx playwright test` (local prod build + live DB, 375 px and 1280 px) | **14/14 passed**; 12 throwaway guests deleted by id; post-run 0 users / 0 rows |
| `npm run security:bundle` (build made with the real `.env.local`) | service-role key name and value not in the client bundle; AI key not set |
| `npm audit` | 2 advisories (PostCSS bundled in Next 15, build-time; fix needs Next 16, unsupported on Amplify): accepted by owner |
| `npm run ai:probe` (Gemini, `gemini-3.5-flash-lite`) | `tools=true vision=true` |
| `E2E_LIVE_AI=1 npx playwright test` (real Gemini) | 16/16 passed (14 regular + 2 live AI on desktop); 14 guests deleted by id; post-run 0 users / 0 rows / 0 messages |

| ID | Status | Evidence |
|---|---|---|
| AC-01 Guest persona → own data, no login | **PASS** | E2E `guest-flow.spec.ts` "persona -> dashboard" (both viewports, real anonymous sign-in + `reset_user_to_persona`) |
| AC-02 Guest A unaffected by guest B | **PASS** | live `rls.live.test.ts` owner isolation on every client table (two anonymous users) |
| AC-03 3 demo email users isolated | **PASS** | seeded 2026-11-24 (student/worker/at_risk, 15 transactions each, email confirmed); re-run skipped all three; each account logged in via the API and saw 1 profile, 15 own transactions, 0 foreign rows; Playwright `demo-accounts.spec.ts` 6/6 (login on 375 px and 1280 px) |
| AC-04 Pre-snapshot transaction changes analytics, not balance | **PASS** (unit) | `tests/finance/balance.test.ts`, `tests/transactions/impact.test.ts` |
| AC-05 Post-snapshot expense decreases balance once | **PASS** | unit tests + E2E "manual expense saves once" |
| AC-06 CSV invalid/duplicate rows labelled; no write before confirm | **PASS** | `tests/import/*` (preview writes nothing), live atomic `commit_csv_import` tests, E2E CSV preview + commit |
| AC-07 Receipt fields editable; saved exactly once | **PASS** | live E2E `live-ai.spec.ts`: rendered receipt image → Gemini draft (Circle K, 45.000 ₫) → edit form → one saved transaction. Gap: server has no idempotency key for create; double save prevented in the UI |
| AC-08 Day-31 clamp in short and leap months | **PASS** (unit) | `tests/finance/recurrence.test.ts`, `forecast.test.ts` |
| AC-09 Sparse data falls back and labels uncertainty | **PASS** (unit) | `forecast.test.ts` fallback cases; dashboard assumptions section |
| AC-10 Interim reserve breach with positive end → unsafe | **PASS** | unit + route tests; E2E simulator run showed "không được tính là giữ được mức dự phòng" on real seeded data |
| AC-11 Repeated simulation deterministic | **PASS** (unit) | 100-replay determinism tests |
| AC-12 AI answer includes real tool results | **PASS** | live E2E: question → real `forecast_cashflow` call → answer citing the 45-day minimum; evidence card shown; quota 20 → 19. Screenshot `desktop-1280-61-live-proposal-approved.png` |
| AC-13 Proposal changes nothing until approval; stale/replay fail | **PASS** (live approve + fakes for stale/replay) | `tests/assistant/proposals.test.ts` (forged, foreign, expired, stale, double and concurrent approve) |
| AC-14 21st chat / 6th scan blocked server-side | **PASS** | live 50-way `reserve_ai_quota` grants exactly 20; route/service tests block before the provider call |
| AC-15 No key → explicit error, other pages work | **PASS** | route tests (503, no quota) + E2E assistant not-configured state with Dashboard still working |
| AC-16 Owner A cannot query owner B | **PASS** | live RLS suite incl. PostgREST direct calls, privileged RPCs denied to anon/authenticated |
| AC-17 375 px, all routes usable, no horizontal scroll | **PASS** (local) | E2E checks scroll width and tap targets on all five routes; screenshots in `docs/evidence/screenshots/` |
| AC-18 Public Amplify app works without developer laptop | **BLOCKED** | not deployed (G4 not approved); runbook `docs/19-amplify-release-runbook.md` |

## docs/08 validation checklist
| Item | Status |
|---|---|
| Guest 1 cannot read guest 2 / demo / real data | PASS (live, guest vs guest); demo accounts pending AC-03 |
| Client cannot read/write another user's `ai_usage_daily`, cannot approve `ai_proposals` | PASS (live: ai_* tables select-only for clients) |
| Quota not bypassable by concurrent calls | PASS (live 50-way) ; bypass via new anonymous identities remains (owner deferred) |
| No `AI_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY` in bundle or payload | PASS for the bundle scan; route DTO tests show no secrets; browser network check on the hosted app pending |
| No logs of receipt images or passwords | PASS by review: logs carry error codes only; images stay in memory |
