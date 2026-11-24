# Release summary (prepared 2026-11-24, NOT released)

Nothing has been pushed, merged or deployed. The repository has no git remote and no commits. The shared Supabase project `llrxhefrqnjdwlmxozul` has migrations 0001–0003 applied (owner-approved G2) and contains **no user data**.

## Task status
| Task | Status | Notes |
|---|---|---|
| 1 Migration 0003 | DONE | applied after dry-run; CSV commit now one DB transaction |
| 2 Live RLS/RPC/quota suites | DONE | 38/38 pass, cleanup verified |
| 3 Seed 3 email demo accounts | DONE | credentials in gitignored `.tmp/demo-accounts.env`; AC-03 PASS |
| 4 AI adapter (T04.1) | DONE, live verified with Gemini | 3 provider bugs found and fixed in live testing |
| 5 Read-only tools (T04.2) | DONE | |
| 6 Assistant API + UI (T04.3) | DONE, live E2E pass | |
| 7 Receipt vision (T04.4) | DONE, live E2E pass | |
| 8 Proposals (T04.5) | DONE | no new migration needed |
| 9 Playwright E2E | DONE | 14/14 on 375 px and 1280 px against the live DB |
| 10 Security review (T05.1) | DONE | AC matrix in `docs/evidence/ac-matrix.md` |
| 11 Docs + submission kit (T05.2) | DONE | URL/credentials placeholders remain |
| 12 Amplify runbook (T05.3) | DONE (preparation) | `amplify.yml`, `docs/19` |
| 13 Release package (T05.4) | **STOPPED at G4** | waiting for owner |

## New dependency in this run
`@playwright/test` 1.65.1 (dev, exact pin) + Chromium headless shell, approved by the owner.

## Known gaps and risks
1. **Gemini free tier is not enough for judges**: the free tier allowed 20 requests/day for `gemini-4-hydrogen` on this project (429 observed), and one chat can use up to 4 model calls. Enable billing (Tier 1) before the demo and set a spend cap. Some models (`gemini-3.8-flash`) returned 503 "high demand" repeatedly; `gemini-3.5-flash-lite` was reliable in testing.
2. Demo account credentials live only in `.tmp/demo-accounts.env` (gitignored). Back it up privately; give it to judges only through the contest channel.
3. Guest quota can be bypassed by creating new anonymous identities (owner deferred). Mitigation on hosting: Supabase anonymous sign-in rate limit/CAPTCHA.
4. Receipt save has no server-side idempotency key; a double submit is blocked only in the UI.
5. Proposal approval is claim-then-apply: a crash between the two leaves a proposal marked approved without the change (data stays consistent; the user can ask again).
6. Amplify Node 22 availability on the build image is unverified (fallback documented).
7. SSR secrets written to `.env.production` are readable by anyone with access to Amplify deployment artifacts (AWS-documented limitation).
8. `npm audit`: PostCSS advisory inside Next 15 (accepted).

## Cost notes
Amplify build minutes + SSR compute + transfer are billed to the AWS account (check the USD 20 credit coverage and set a Budget alert). AI provider billing is separate; quotas cap usage at 20 chats + 5 scans per user per day, at most 4 model calls per chat. Set a provider spend cap.

## Owner actions, in order
1. Correct `NEXT_PUBLIC_SUPABASE_URL` in `.env.local` to the origin (drop `/rest/v1/`).
2. Fill `AI_*` in `.env.local`; run `npm run ai:probe` (expects `tools=true vision=true`).
3. Fill `SEED_USER_1..3_*`; run `npm run seed:demo` (dry-run), then approve and run `SEED_ALLOWED_PROJECT_REF=llrxhefrqnjdwlmxozul SEED_CONFIRM_PROJECT_REF=llrxhefrqnjdwlmxozul npm run seed:demo:apply`.
4. Create the GitHub repository, `git add` / commit locally, add `origin`.
5. Approve G4, then `git push -u origin main` and follow `docs/19` (env vars, Supabase redirect URLs, smoke test).
6. Fill the URL in `docs/submission/*`, record the video, export PDFs, run `scripts/make-source-zip.sh --write`.

## Rollback
App: redeploy the previous Amplify build or revert the commit. DB: rollback scripts in `supabase/proposed/` (separate G2 approval). Disable AI by removing `AI_API_KEY`.
