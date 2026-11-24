# 08 · Security, Privacy and Shared Supabase Policy

## Threat model highlights
1. **Cross-user data leak** (guest or email account reading another's finances): owner-scoped RLS for all tables, authorization tests; never trust body `user_id`.
2. **Service-role key leaked** (bypasses RLS): use only server-side, minimal endpoints; never put in browser bundle, logs, repository or Stitch export.
3. **Malicious CSV/image prompt injection**: limit file types/sizes, parse as data, prompt isolation, no execution/eval, sanitize rendered strings.
4. **AI hallucinated monetary advice**: deterministic tool returns, show sources/assumptions, do not claim guarantees or execute payments.
5. **Budget abuse**: auth, per-user atomic quotas, additional IP-level and abuse limits as feasible (behind proxies carefully), request limits, spend alerts.
6. **Shared DB migration accident**: dry-run, backup, explicit approval and rollback plan; do not link test scripts to global destructive operations.
7. **Sample login data contamination**: three demo accounts distinct, with optional manual reset per account and no shared-user merging. Guest personas copied into isolated user data.

## Mandatory controls
- Supabase **Anonymous Sign-Ins** enabled for Guest; these users assume `authenticated` Postgres role. RLS must always compare `auth.uid()` to owner; never equate guest with Postgres `anon` role.
- Enable RLS on every business table; explicit `SELECT`, `INSERT`, `UPDATE`, `DELETE` owner policies where needed. Prevent cross-owner child FK linking.
- AI proposals/quota tables have no direct client-side write policies; server-only service actor after verified user identity.
- Do not put personal financial data in public storage buckets; process receipt in memory where possible, or private owner-namespaced bucket with RLS/signed short-lived URLs after review.
- Cap MIME types/bytes; never trust file extensions or AI-extracted JSON.
- Protect against CSRF/session confusion for mutating Next.js routes; use Supabase SSR auth patterns, origin checks as appropriate, HTTP-only cookies where used.
- Avoid exposing raw stack traces or secrets in UI/logs. Minimize retention of image bytes and raw AI prompts; do not upload real bank statements for demo.
- Explicitly classify demo as **synthetic**. No real banking connection; current balance is user-reported estimate.

## Data deletion and expiry
- Guests time-limited conceptually; actual TTL cleanup via scheduled job is **not authorized by this document**. For MVP use individual Reset and sign-out with privacy notice. If cleanup later approved, must be owner/scoped and tested.
- Support user-requested deletion via approved, audited flow; avoid automatic global cleanup on a shared DB.

## Operations guardrails
Allowed without destructive mutation: inspect local code; lint, typecheck, unit test; read-only Supabase metadata checks after confirming target. Not allowed without specific user consent: hosted migration, seed, reset, auth admin user writes, delete records, push/PR/deploy, credit-consuming AWS resource creation.

## Validation checklist
- Verify anonymous guest 1 cannot read guest 2, demo account 1, or real account data.
- Verify client cannot read/write `ai_usage_daily` for another user; cannot directly mark `ai_proposals` approved.
- Verify quota cannot be bypassed through concurrent calls.
- Verify no `AI_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` appears in JS bundle or browser network payload.
- Verify no logs store receipt images or raw passwords.
