# 03 · Critical User Flows and Edge Cases

## Flow G1 — Anonymous guest demo
1. Welcome → pick one of student/new-worker/at-risk persona.
2. `signInAnonymously()` (Supabase Auth enabled), obtain authenticated identity/session.
3. Server creates user-owned profile + transactions + recurring items + goal from **static seed fixtures**, atomically/idempotently; never modifies persona source files or other users.
4. Dashboard displays demo badge and sample data. User may edit their **private copy**.
5. Reset asks explicit confirmation and replaces only this authenticated user's records with fresh persona copy. Trigger must have authorization and transaction-style rollback safety.
6. TTL expiry policy is a separate approved cleanup action; don't implement blanket deletion without user approval.

## Flow A1 — Email/password user
Sign up / login using Supabase Auth; create default profile; optional short onboarding; return to Dashboard. After logout no user-specific data shown. Auth and user-record ownership are distinct: never trust `user_id` from client payload.

## Flow T1 — Manual transaction
Form → validate integer positive amount, type/date/category → save as user-owned row → recalc current balance only if event_at > snapshot timestamp and kind affects cashflow → refresh dashboard. Link to recurring instance if relevant to prevent future duplicate forecast.

## Flow T2 — CSV import
Upload ≤2MB → parse headers, map source columns → preview rows → identify invalid/possible duplicate via fingerprints and close matches → user selects rows and edits → commit batch only after approval → return imported counts, duplicates skipped by choice, failed rows with explanation. Idempotency for double-clicks.

## Flow T3 — AI receipt
Upload ≤5MB; server checks MIME and bytes; vision extraction with provider; show confidence/uncertainty; editable merchant/date/total; explicit save; never save raw receipt publicly. Quota consumed on accepted AI request; timeout yields retry message and no fake transaction.

## Flow S1 — Purchase comparison
Simulator collects cost and later date → deterministic engine projects 45 days baseline → apply purchase on selected day for each independent scenario → compute min, end, reserve violations across same period → display comparative result → optionally ask Assistant for explanation. Modeling makes assumptions visible.

## Flow AI1 — Read/analysis
Input user message → authenticate & server quota check → route to provider adapter → limited allowlist tool calls → tools compute own-user facts → model synthesizes grounded answer + caveats. Tool steps/timeouts bounded. If no valid key/model: explicit configuration failure (never a fake answer).

## Flow AI2 — Proposed write
Model proposes updated monthly budget or goal → server validates structured proposal and stores as `pending` with expiration and baseline version → UI renders old/new diff → user clicks Confirm/Reject → server verifies ownership, scope, state, freshness → approved mutation executed once; UI refreshes related views. No automated payment, recurring-item modification, transaction addition or other AI writes.

## Edge-case checklist
- Imported transaction before snapshot changes *history analytics*, not current balance.
- Future-dated transactions do not affect today's balance prematurely.
- Recurrence day 31 in February clamps to Feb 28/29; leap year test required.
- Same expense present in recurring schedule and confirmed transaction must be reconciled, not doubled.
- Refunds or internal transfers classified as excluded need user-understandable semantics; excluded does not change cash balance unless explicitly modeled separately; no multi-wallet in MVP.
- Duplicate imports remain suspect, not automatic guilt; allow user override.
- Insufficient history: use profile's expected daily variable expense; show an assumption indicator.
- One goal only; show error for attempted second active goal.
- If AI unavailable, CRUD and simulator must continue working.
- An anonymous guest token is `authenticated` in Supabase RLS: never use `TO anon` as guest data policy.
- Shared DB: test and judge records must not share user_id or service-role context.
