# Supabase Schema & Seeding Protocol

## Important: one hosted DB, NO auto-apply
`migrations/202611230001_finpilot_initial.sql` is a **candidate** schema. It has not been executed against a real Supabase instance. Review the migration's RLS/policies and syntax with Kiro and the actual Supabase CLI/version, then obtain **G2 approval** for the exact remote operation. `seed.sql` is deliberately a no-op. No DB connection details are included.

## Tables and RLS
See `docs/05-data-contracts.md`. `financial_profiles`, `transactions`, `recurring_items`, `import_batches`, `savings_goals` support owner-bound CRUD. `ai_conversations`, `ai_messages`, `ai_proposals`, `ai_usage_daily` are owned readable records, server-only writes. `consume_ai_quota()` is executable by service role only after API authenticates caller; use it to reserve guest quota atomically. Supabase anonymous Auth users assume `authenticated` DB role, not Postgres `anon`.

## Important SQL compatibility point
The migration uses PostgreSQL column-specific `ON DELETE SET NULL` on composite foreign keys so `transactions.user_id` and `ai_proposals.user_id` are retained when the optional related object is deleted. Verify PostgreSQL/Supabase hosted version supports this syntax before applying. If not supported, change FK deletion behavior to `RESTRICT` and implement explicit unlink under review; **never** fall back to setting owner_id NULL.

## Auth demo population
1. Prepare three user-supplied synthetic emails/passwords (secret channel; not repository).
2. With explicitly approved admin script, `auth.admin.createUser` for three owner identities and set email confirmed according to Auth service policy. Avoid listing actual passwords in logs or PR.
3. Map `persona_code` to Auth `user.id`; idempotently insert/update only rows owned by those three identities, first verifying current state and asking for approval if existing transactions would be overwritten.
4. Verify 3 separate login flows and cross-account isolation.
5. Guest starts via `signInAnonymously` then creates **private copy** of selected persona fixture. Guest reset requires per-user confirmation and scope; never resets 3 demo logins.

## Fixture date strategy
The CSV examples use a reference anchor date (`2026-11-23`) to keep them human-readable. During account/guest seeding, **shift sample timestamps by calendar-day difference** to the chosen anchor day in Asia/Ho_Chi_Minh; update snapshot date, recurring effective date and savings goal target consistently. Do not shift dates when importing a real user's CSV. Verify resulting sample balance/forecast invariants with engine before committing.

## Validation before live use
- Unit-level SQL/policy review in an isolated temporary testing tool only if user explicitly authorizes resources; no second production/dev DB required.
- Hosted migration plan/dry-run against the existing project.
- Verify non-privileged authenticated user cannot query another owner and cannot write AI proposal/quota tables.
- Verify `service_role` key stays server-only.
- Verify nullable composite FK behavior when deleting an import batch/recurring item; avoid unintended mass removal.
- Verify AI quota increments atomically.
