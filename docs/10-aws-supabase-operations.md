# 10 · AWS Amplify + Single Supabase Runbook

## One shared Supabase Project
- Create/select **one** Supabase project; configure anonymous auth and email/password auth, allowed redirect origins for `localhost` and Amplify production URL.
- Store project URL & publishable key in local `.env.local` and Amplify environment settings; both must point to **same project**.
- Service-role key only in secured server runtime/admin environment for approved actions. Apply RLS before onboarding any users.
- Migrations file `supabase/migrations/202611230001_finpilot_initial.sql` is a candidate and must be code-reviewed; **do not auto-apply**. `supabase/seed.sql` intentionally does no remote user creation.

## Pre-migration workflow (independent approval G2)
1. Verify correct Supabase project ID/ref (read-only) and latest migration state.
2. Review SQL for destructive actions, child ownership, RLS and security-definer risk.
3. Obtain a backup/restore or rollback plan adequate to the hosted plan; do not assume PITR is included in free tier.
4. Use read-only inspection/dry-run (`supabase db push --dry-run --remote` if supported by installed CLI), record output.
5. Ask user to approve **specific** exact migration command and impact.
6. Apply once when approved, validate tables/policies and record migration ID.

**Never run** `supabase db reset --remote` or any broad delete/truncate against shared project. Do not set `SUPABASE_YES=1` as a convenience to bypass confirmation.

## Demo seed workflow (separate approval G2)
- Source fixtures in `mock-data/` define personas and sample transactions.
- After Auth admin creates three isolated login accounts with **user-supplied** emails/passwords, perform idempotent per-account inserts using their user IDs only.
- Guest start creates fresh anonymous identity then copies the chosen persona through a server endpoint transaction guarded by user authorization; no global re-seed.
- If seed script not yet implemented, Kiro implements it after plan approval; **no hardcoded passwords**, no public service key.
- Seed source is not runtime source of finance truth; all CRUD and forecast read Supabase after copying.

## Amplify hosting (G4 for deploy)
1. Prepare Next.js repository and verify AWS Amplify's **currently supported** Next.js version. At authoring, AWS support page explicitly covers SSR through Next.js 15; pin tested version, do not auto-upgrade.
2. Connect GitHub repo after user approval; configure build command/Node runtime for chosen version; avoid adding an unverified `amplify.yml` blindly.
3. Configure public Supabase URL/publishable key and server-only `AI_*` secrets; validate the SSR server runtime actually sees them. AWS documents special handling of SSR environment variables. **Do not print values in logs**.
4. Configure `NEXT_PUBLIC_APP_URL`, Supabase Auth redirect URL, CORS/cookie behavior as needed for the final Amplify domain.
5. Set AWS budget/cost alerts; confirm $20 contest credit eligibility and expiry (AWS service usage is not necessarily free).
6. Push to `main` **only after explicit user approval**. Amplify is then allowed to auto-deploy.
7. Smoke-test mobile + desktop login/Guest, Supabase interactions, AI Chat/tools, scan and simulator. If anything fails, preserve logs sans secrets and propose safe rollback.

## Release freeze & cost
- User separately approves production URL/public launch and pushes. Document deployed commit hash and time.
- Before contest deadline, validate product accessible without developer's laptop. Don't alter running product after cutoff if contest rules prohibit updates.
- API provider billing is separate from AWS credit. Enforce quotas and call step limits; set provider spend caps where available.

## Operational troubleshooting
| Symptom | Check |
|---|---|
| Auth redirect loops | Supabase Site URL/allowlist, SSR cookies, Amplify origin |
| AI works locally but not Amplify | Server runtime env availability, Base URL/model/tool support, key redaction |
| 403 for user-owned data | Verified Auth JWT, RLS owner equality, anonymous-user authenticated role |
| Demo data changes unexpectedly | Two users accidentally sharing account ID; idempotency/reset authorization |
| SSR build fails | Next.js/Node compatibility and build logs; don't silently disable SSR |
| AWS charges unexpectedly | Amplify build frequency, SSR compute, transfer, extra AWS resources |
