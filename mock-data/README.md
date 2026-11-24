# Synthetic Demo Dataset / Seed Specification

Fixtures: `personas.json`, `transactions.csv`, `recurring-items.json`, `savings-goals.json`. These are **seed source / test fixtures only**. Production app always reads/writes the **one shared Supabase PostgreSQL DB**. No sample login email/password is stored here.

## Personas
1. `student`: 5M VND monthly allowance, rent, education costs, laptop goal.
2. `worker`: 12M salary, rent, emergency reserve goal.
3. `at_risk`: 9M salary, rent and installment, near-term cashflow warning.

Numbers are fictional and need deterministic verification after shifting dates and reconciling scheduled events. `reference_date=2026-11-23` is for readable fixture timestamps, **not a hard-coded runtime 'today'**.

## Seeding to one Supabase DB (requires G2 approval)
- Ask user to provide 3 sample login credentials securely.
- Create or locate identities with Supabase Auth Admin API on approved operation, never insert into `auth.users` using plain SQL.
- Map each user's `auth.users.id` to persona; idempotently create exactly one profile, one goal, relevant recurring rows and synthetic transactions. Do not re-seed existing users without explicit review.
- Guest sign-in uses a **new Auth anonymous user**; selecting persona copies a fresh user-owned record set, not shared records or global template table.
- Shift all fixture timestamps by the same **calendar-day delta** based on current Asia/Ho_Chi_Minh day, ensuring snapshot and transaction pre/post relationship remains intact. Shift goal deadlines/recurring start dates as intended and check forecast covers meaningful near-term events.
- Synthetic historical transactions from before snapshot contribute to history; snapshots must not be recalculated by subtracting them again.
- Validate seeded user isolation, transaction counts, future-recurring handling and reserve logic, then ask for approval before real write.

## CSV input sample
`transactions.csv` is canonical seed format with `persona_code,occurred_at,kind,amount_vnd,category,merchant,description`. Real user imports may have arbitrary bank-style columns and should pass through mapping/preview.

## Synthetic data quality
- Use at least 5 transactions across >=7 distinct dates in the 30-day history for each persona, or clearly fall back to their expected daily expense. This fixture provides ~15 per persona.
- Include no bank account number, card PAN, real name or address.
- Repeatable data required: date shifting must preserve ordering and recurrence link semantics.
