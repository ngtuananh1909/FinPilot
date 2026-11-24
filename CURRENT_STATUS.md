# Current Project Status — 2026-11-24

| Area | Status |
|---|---|
| Product scope v1.0 | Approved (G0) |
| Implementation plan | Approved (G1) |
| Next.js app (5 pages + welcome/auth/onboarding) | **Implemented**, builds on Next.js 15.5.29 |
| Finance engine, transactions, CSV, settings, dashboard, simulator | Implemented and tested |
| AI adapter, tools, Assistant, receipt scan, proposals | Implemented; live-verified with Gemini `gemini-3.5-flash-lite` (and OpenRouter Nemotron as fallback) |
| Supabase (one shared project `llrxhefrqnjdwlmxozul`) | Migrations 0001–0003 applied (G2); no user data |
| Live RLS/RPC/quota tests | 38/38 pass |
| E2E (Playwright, 375 px + 1280 px) | 14/14 pass against the live DB |
| 3 email demo accounts | Created and verified (credentials in gitignored `.tmp/demo-accounts.env`) |
| Git remote | `origin` = git@github.com:ngtuananh1909/FinPilot.git (no commit, no push yet) |
| AWS Amplify deployment / public URL | **Not done**: waiting for G4 |
| Evidence | `docs/evidence/ac-matrix.md`, `docs/evidence/release-summary.md` |
| Next owner actions | See `docs/evidence/release-summary.md` → "Owner actions, in order" |
