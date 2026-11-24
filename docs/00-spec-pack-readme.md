# FinPilot AI — MVP Specification Pack v1.0

**Project:** MoMo Tech Contest 2026 · Imagine the Future Workspace (Human Centered. AI Powered)  
**Status:** Product decisions approved 2026-11-23; implementation, credentials, migration, push and deployment are **NOT** approved by this package.  
**Deliverable:** documentation, executable *candidate* schema, seed-data fixtures/specification, Kiro steering/specs/tasks, Stitch prompt, agent prompts. **No finished web application is included.**

## Read this first
1. Unzip these files into the **repository root**. Review conflicts before overwriting an existing `.kiro/`, `AGENTS.md`, `supabase/` or `.env.example`.
2. Read [DECISIONS.md](DECISIONS.md), [AGENTS.md](AGENTS.md) and [docs/01-prd.md](docs/01-prd.md).
3. In Google Stitch, use [prompts/STITCH_MASTER_PROMPT.md](prompts/STITCH_MASTER_PROMPT.md). Stitch owns visual design; don't force pixel-level designs from these docs.
4. Export Stitch designs and place them under `design/stitch/exports/<version>/`, preserving `DESIGN.md` if exported. Do not replace source code.
5. Open the repository in **Kiro IDE** with Model Auto (if available), copy [prompts/KIRO_BOOTSTRAP_PROMPT.md](prompts/KIRO_BOOTSTRAP_PROMPT.md) into chat. The agent **must request approval of its repository-specific implementation plan before coding**.
6. Use [.env.example](.env.example) as a template for `.env.local`. Add secrets **manually**; never commit them.
7. Use one Supabase project/database for local app and judges' AWS-hosted app. No second dev/staging database. Do **not** execute migration or seed against it until user approval.

## Contents
- `DECISIONS.md` — approved / deferred / non-goals and resolution order.
- `docs/` — product scope, page specs, flows, data, financial engine, AI, security, testing, hosting, demo, unresolved runtime configuration.
- `.kiro/steering/` — persistent product/technology/security/structure guidance.
- `.kiro/specs/finpilot-mvp/` — requirements, implementation design and task plan.
- `supabase/migrations/` — candidate initial SQL schema + RLS; review before applying.
- `supabase/seed.sql` — intentionally contains no destructive or automatic demo-user inserts.
- `mock-data/` — deterministic persona/transaction/recurring/goals **seed source files**, not a runtime database.
- `prompts/` — Stitch prompt (simple), Kiro bootstrap, Stitch import and verification prompts.
- `.env.example` — configurable Gemini/OpenRouter base URL, API key and model; placeholders only.

## Approved core
Five pages: `/dashboard`, `/transactions`, `/assistant`, `/simulator`, `/settings`; students + new workers; guest demo plus three optional email/password demo accounts; manual/CSV/AI receipt inputs; tool-calling AI with confirmation before writes; compare buy-now vs buy-later; 45-day forecast; savings goal in settings; mobile-first, light theme, Stitch decides visual design; AWS Amplify hosting; **a single shared Supabase DB** with per-user RLS.

## Approval gates — always enforce
- **G0 (business):** Product scope approved; this is NOT permission to push/deploy or mutate remote DB.
- **G1 (implementation plan):** Kiro audits local repository, produces a delta-based plan and awaits explicit user approval before implementation.
- **G2 (remote database):** For *each* remote migration, seed, deletion, admin-user mutation, or data correction: produce dry-run/read-only impact + backup/rollback plan; await explicit approval.
- **G3 (task/feature):** Perform tests, self-review, security/RLS review, collect evidence; user approves material scope changes.
- **G4 (release):** Never `git push`, create/merge PR, change production settings, or trigger Amplify deployment without explicit user approval. Amplify may auto-deploy an **approved push to main**.

## Reference docs (verification as of 2026-11-23)
- Kiro specs: https://kiro.dev/docs/specs/
- Kiro steering: https://kiro.dev/docs/steering/
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Anonymous Auth: https://supabase.com/docs/guides/auth/auth-anonymous
- AWS Amplify Next.js: https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html
- AWS Amplify SSR env: https://docs.aws.amazon.com/amplify/latest/userguide/ssr-environment-variables.html
