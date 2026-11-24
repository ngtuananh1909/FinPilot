# 17 · Demo account seeding / Seed 3 tài khoản demo (T02.2)

> **Status / Trạng thái: NOTHING HAS BEEN EXECUTED.** The script was written and tested only against an in-memory fake. It has never contacted the shared Supabase project. / Script mới chỉ được kiểm thử với bản giả lập trong bộ nhớ, chưa từng chạy trên Supabase thật.

Approval gate: **G2** (docs/10, AGENTS.md). Run it only after you approve the exact scope below, and only after the hardening migration (`reset_user_to_persona`) is applied to the same project.

## What it does / Script làm gì
| Slot | Env variables | Persona |
|---|---|---|
| 1 | `SEED_USER_1_EMAIL`, `SEED_USER_1_PASSWORD` | `student` |
| 2 | `SEED_USER_2_EMAIL`, `SEED_USER_2_PASSWORD` | `worker` |
| 3 | `SEED_USER_3_EMAIL`, `SEED_USER_3_PASSWORD` | `at_risk` |

For each account, in order:
1. Looks the user up by email (`auth.admin.listUsers`, paged). **Found → reused, password never changed.** Not found → `auth.admin.createUser` with `email_confirm: true`.
2. Reads `financial_profiles` for that user. Same persona with `is_demo = true` → **skip** (idempotent). Otherwise calls RPC `reset_user_to_persona` once with key `seed:<persona>:<userId>:v1`.
3. A profile with `is_demo = false`, or a different persona, is reported as **BLOCKED** and left untouched (`--force` overrides only the different-persona case, never `is_demo = false`).

It never deletes users, never updates passwords, never logs passwords/keys, and prints e-mails masked (`a***@d***.com`).

## Remote changes it would make / Thay đổi trên DB thật
- `auth.users`: up to **3 new** confirmed email users (only those not already present).
- `public.financial_profiles` (1 row per user, upsert), `recurring_items`, `transactions`, `savings_goals`, `reset_log` (1 row per account) for those 3 user ids only. No other user's rows are touched (the RPC is scoped by `p_user_id`).

## Commands (run in YOUR OWN terminal) / Lệnh chạy
Put these names in `.env.local` (never commit; never set them in Amplify). Values are yours:
```
NEXT_PUBLIC_SUPABASE_URL=            # already present
SUPABASE_SERVICE_ROLE_KEY=           # already present, server-only
SEED_USER_1_EMAIL=   SEED_USER_1_PASSWORD=    # password >= 12 chars, all 3 distinct
SEED_USER_2_EMAIL=   SEED_USER_2_PASSWORD=
SEED_USER_3_EMAIL=   SEED_USER_3_PASSWORD=
SEED_ALLOWED_PROJECT_REF=            # only for --apply: the project ref (the part before .supabase.co)
SEED_CONFIRM_PROJECT_REF=            # only for --apply: type the same ref again, deliberately
```

1. **Offline rehearsal** (no network, in-memory): `npm run seed:demo -- --fake --apply`
2. **Dry-run** (default; validates env, prints plan, **no network**): `npm run seed:demo`
3. **Apply** (real writes): `npm run seed:demo:apply`
   - Refuses unless `NEXT_PUBLIC_SUPABASE_URL` is a hosted `<ref>.supabase.co` URL and both `SEED_ALLOWED_PROJECT_REF` and `SEED_CONFIRM_PROJECT_REF` equal that ref.
   - Re-clone existing accounts: add `-- --force` (new idempotency key per forced run).
   - The real admin client is created only for step 3.

Needs Node >= 22.15 (`module.registerHooks`; Node 22.x requires `--experimental-strip-types`, already in the npm script). `scripts/seed-ts-loader.mjs` only maps the `@/` alias and `.ts` extensions; no new dependency was added. The npm scripts load `.env.local` through Node's `--env-file-if-exists`; values already set in your shell take precedence.

Exit codes: `0` ok, `1` error or any BLOCKED account, `2` bad arguments.

## Rollback / Hoàn tác
- The script only adds rows for the 3 accounts. To undo: Supabase Dashboard → Authentication → Users → delete **only the 3 users created by this run** (ids are printed on apply). `on delete cascade` removes their profile, transactions, recurring items, goals and reset log.
- Users that already existed were reused, not created: do **not** delete them. Re-run with `--force` to reset their persona data instead.
- Never run `supabase db reset`, truncate, or broad deletes against this shared project.

## Not verified / Chưa kiểm chứng
Anything touching the real Auth admin API (`listUsers` pagination, `createUser`, RLS-bypassing `financial_profiles` read, the live RPC) is untested. Verify with the dry-run first, then read the printed ids after `--apply`.

Tests: `tests/demo/seed-*.test.ts`.
