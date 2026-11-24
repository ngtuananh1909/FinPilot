# 05 · Data Model, API Contracts and CSV Format

## Model ownership
Every business entity is owned by `auth.users.id` (anonymous and email users). Do not allow client-supplied `user_id`. Use RLS `auth.uid() = user_id` and service-role only behind verified server routes. Cross-table relationships must not cross owners.

| Table | Key fields | Intended behavior |
|---|---|---|
| `financial_profiles` | `user_id`, `balance_snapshot_vnd`, `balance_snapshot_at`, `expected_daily_expense_vnd`, `projected_monthly_budget_vnd`, `minimum_reserve_vnd`, `payday_day`, `expected_monthly_income_vnd`, `persona_code` | One profile per Auth user; source for personalized assumptions |
| `import_batches` | `id`, `user_id`, `source`, `status`, row counts, `idempotency_key` | Auditable commits, preview client-side/server ephemeral |
| `recurring_items` | `id`, `user_id`, `kind`, `amount_vnd`, `day_of_month`, `start_date`, `end_date`, `active` | Monthly recurring events, with clamp to end-of-month |
| `transactions` | `id`, `user_id`, `occurred_at`, `kind`, `amount_vnd`, `category`, `source`, `merchant`, `recurring_item_id`, `recurring_instance_date`, `import_batch_id`, `fingerprint` | History, current balance post snapshot, reconciled recurrence |
| `savings_goals` | `user_id` unique, `target_vnd`, `saved_vnd`, `target_date`, `name` | Max one active goal per user |
| `ai_conversations` | `id`, `user_id`, `title` | History by owner |
| `ai_messages` | `id`, `conversation_id`, `user_id`, `role`, `content`, `tool_result` | Historical chat; minimize private data retention |
| `ai_proposals` | `id`, `user_id`, `kind`, `payload`, `baseline`, `status`, `expires_at` | Server-only modifications, confirmation gating |
| `ai_usage_daily` | `(user_id, usage_date)`, `chat_calls`, `scan_calls` | Server quota, local Vietnam calendar day |

## Money and time
- DB `BIGINT` integer VND, no fractions or currency conversion.
- JS type conversions: request/response amounts should be **decimal strings** (`"1500000"`) and validated to a bounded safe integer; internal calculations use `bigint`, explicitly stringify at JSON boundary.
- Date-only for recurring schedule and goal deadline, full timestamptz for actual transaction/snapshot timestamps. Day buckets `Asia/Ho_Chi_Minh`.
- Transaction types: `income`, `expense`, `excluded`. `excluded` is out of cash/budget computations; note limitations of a one-wallet view.

## Example request/response outlines (agent refines, keeps semantics)

```json
// POST /api/simulations/purchase (illustrative JSONC, not literal JSON fixture)
{"cost_vnd":"1500000","buy_now_date":"2026-11-23","buy_later_date":"2026-12-02"}
```

```json
{"horizon_days":45,"reserve_vnd":"300000","assumptions":["daily_variable_expense_from_history"],"scenarios":[{"name":"now","minimum_vnd":"150000","final_vnd":"2100000","safe":false},{"name":"later","minimum_vnd":"450000","final_vnd":"2100000","safe":true}]}
```

All example figures here are **illustrative** and not a validated input/output pair: test fixtures must calculate exact outputs via engine. Return assumptions, minimum date, reserve breaches, and sources rather than only a single answer.

## Proposed API behavior & guards
- `/api/transactions`: validation, ownership, sorting, pagination; reject out-of-bounds values and invalid date strings; rate-limit bulk writes.
- `/api/imports/csv/preview`: file max 2MB, parse mapped fields, normalize amount/date, classify; returns row errors, fingerprint conflicts and suggestions; does not commit.
- `/api/imports/csv/commit`: require explicit `confirmed` flag, reviewed row identifiers and idempotency key; record batch and transaction inserts atomically as feasible, rollback on partial errors.
- `/api/receipts/extract`: owner verified, 5MB image max, MIME check, quota; structure JSON `{merchant, occurred_at, total_vnd, confidence, warnings}`. AI result treated as untrusted; user confirms through transaction create.
- `/api/assistant/chat`: auth check, atomically reserve quota, process context/tool loop bounded by 4 steps; user can view evidence; never execute write proposal without confirm.
- `/api/assistant/proposals/:id/approve`: verify owner/status/expiry/revision and allowlist of fields, apply once; reject stale proposals.

## CSV import canonical fields
UTF-8 with header:

```csv
persona_code,occurred_at,kind,amount_vnd,category,merchant,description
student,2026-11-01T12:30:00+07:00,expense,45000,food,Canteen,Lunch
```

`persona_code` is seed metadata (not part of imported user files). For public user CSV files, map their columns to `occurred_at, kind, amount_vnd, category, merchant, description`. User may map localized Vietnamese headings and date formats; ambiguous formats require preview/confirmation.

## Duplicate detection
- Exact repeat: same owner + source import idempotency key or stable source fingerprint.
- Suspected duplicate: same amount/kind/local date, close merchant/description. **No automatic deletion**; mark possible duplicate, user confirms row.
- Real distinct transactions can share day/amount/merchant; avoid unique constraint on `(date,amount,merchant)`.

## Seed sources
`mock-data/personas.json`, `transactions.csv`, `recurring-items.json`, `savings-goals.json` are **development/initialization fixtures**. They are never queried as a second runtime data store; a limited seed pipeline writes owner-specific rows to the single Supabase DB.
