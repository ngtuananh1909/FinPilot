# FinPilot AI MVP — Requirements (User-Approved Product Scope)

**Requirements source:** `DECISIONS.md`, `docs/01-prd.md`, `docs/02-page-specs.md`, `docs/03-user-flows.md`, `docs/09-testing-and-acceptance.md`. Product requirements approved; **implementation G1 plan, remote DB G2 and release G4 are not pre-approved**.

## Requirement R1 — Accessible 5-page product
**User story:** As a student or new worker, I want one responsive product that helps track, forecast and plan cashflow.
- WHEN I open the public app, THEN I can choose Guest Demo or optional email/password login.
- WHEN I use mobile, THEN Home/Thu chi/AI/Mô phỏng appear as bottom tabs; Settings is reachable via avatar.
- WHEN I use desktop, THEN all 5 main pages remain usable, with no accidental sixth page for savings goals.

## R2 — Private demo and accounts
**User story:** As a judge, I want instant trial without exposing others' financial data.
- WHEN I pick one of 3 personas, THEN a fresh isolated guest identity receives its own copy of synthetic data.
- WHEN I reset, THEN only my guest data returns to its persona sample state after confirmation.
- WHEN I log in to one of 3 demo accounts, THEN I see only that account's data.
- IF RLS denies cross-user access, THEN no other account's records are exposed.

## R3 — Correct transaction ingestion
- WHEN I manually add/edit/delete income, expense or excluded item, THEN validation and owned DB storage are applied.
- WHEN I import CSV, THEN I can map columns, review duplicates and errors, and confirm before inserts.
- WHEN I scan receipt, THEN AI extracts merchant/date/total for an editable preview and writes only on explicit save.
- WHEN a transaction predates a snapshot, THEN it affects historical analytics, not current balance.

## R4 — Forecast and cash reserve
- WHEN I view dashboard, THEN a deterministic **45-day** forecast reflects current estimated balance, monthly recurring items and variable expenses.
- WHEN history is insufficient, THEN fallback assumptions are shown explicitly.
- WHEN a monthly payment day exceeds month length, THEN it falls on the last valid day.
- WHEN a recurring event is already posted, THEN it is not also projected as pending.

## R5 — Purchase simulator
- WHEN I enter a positive amount, THEN Buy Now and Buy Later use identical 45-day modeling assumptions.
- WHEN I choose next payday or an explicit future date, THEN system validates it is inside horizon.
- IF any daily projected balance is under minimum reserve, THEN scenario is marked not safe even when month-end balance is positive.
- THEN UI explains cashflow, assumptions, alternative options and uncertainty without guaranteeing outcome.

## R6 — AI with real tools, approval and spending limits
- WHEN I ask about personal finances, THEN AI calls scoped server tools for real data and returns sourced numbers/assumptions.
- WHEN AI proposes changes, THEN only projected monthly budget or one savings goal can be modified after explicit confirmation.
- IF quota exceeds **20 guest chat requests** or **5 guest receipt scans** per Vietnam day, THEN server rejects further use clearly.
- IF AI provider/key/model unavailable, THEN AI reports configuration/availability issue; non-AI pages still work.

## R7 — One DB, AWS hosting, controlled releases
- WHEN running locally or on AWS, THEN both connect to exactly one Supabase project, isolated by distinct authenticated user IDs.
- BEFORE remote mutation/seed, THEN Agent presents specific impact and waits for user approval.
- BEFORE push/PR/deploy, THEN Agent presents test evidence and waits for explicit user approval; Amplify auto-deploys only after approved main push.

## R8 — Quality and submission
- WHEN performing acceptance, THEN pass AC-01 through AC-18 in `docs/09-testing-and-acceptance.md` or explicitly report blockers.
- WHEN submitting, THEN prepare public URL, ≤1 A4 page PDF usage guide, full source ZIP + README, ≤10 PDF slides and ≤3 minute real demo MP4.

## Non-functional requirements
- Accessible mobile-first interface and Vietnamese primary content.
- No bank integration/payment, no data leakage, no code secrets, no unapproved additional infrastructure or database.
- Every money calculation reproducible; server-side schemas and RLS; progress and failure reports truthful.
