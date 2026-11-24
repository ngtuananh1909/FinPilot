# FinPilot AI

Trợ lý quyết định tài chính cá nhân cho sinh viên và người mới đi làm (MoMo Tech Contest 2026, hạng mục AI Assistant). Ứng dụng web mobile-first, tiếng Việt, 5 trang: **Tổng quan, Thu chi, Trợ lý AI, Mô phỏng, Cài đặt**.

> Dữ liệu demo là **dữ liệu mẫu tổng hợp**. Ứng dụng không kết nối ngân hàng, không chuyển tiền, không đưa ra lời khuyên đầu tư. Số dư là số dư người dùng tự khai báo; dự báo và mô phỏng là **ước tính**.

The original specification-pack README is kept at [docs/00-spec-pack-readme.md](docs/00-spec-pack-readme.md).

## What it does
- **Guest demo** with 3 synthetic personas (student, new worker, at-risk cash flow), each a fresh anonymous Supabase identity with its own copy of the data, plus optional email/password accounts.
- **Transactions**: manual entry, CSV import with column mapping, preview and duplicate review (nothing saved until confirmed), AI receipt scan producing an editable draft.
- **Deterministic 45-day forecast** (integer VND, Asia/Ho_Chi_Minh days, balance snapshot anchor, monthly recurrence with month-end clamp, no double counting) and rule-based alerts.
- **Simulator**: buy now vs buy later on the same baseline; "safe" only if every day stays ≥ 0 and ≥ the user's minimum reserve.
- **AI Assistant** with real tool calling over six read-only finance tools; it may only *propose* a budget or savings-goal change, applied after the user clicks Confirm. 20 chats and 5 receipt scans per user per Vietnam day, enforced in the database.

## Stack
| Layer | Choice |
|---|---|
| App | Next.js 15.5.29 (App Router, Node runtime, no streaming), React 19.1.10, TypeScript 5.9 strict, Tailwind CSS 3.4 |
| Data/Auth | One Supabase project (PostgreSQL 17, Auth anonymous + email/password, RLS on every table) |
| AI | One OpenAI-compatible HTTP adapter for Gemini or OpenRouter (no vendor SDK), configured by env |
| Validation | zod 4 at every boundary |
| Tests | Vitest 5 (unit, route, static SQL, live RLS), fast-check, Playwright 1.65 (E2E, 375 px and 1280 px) |
| Hosting | AWS Amplify Hosting (see [docs/19-amplify-release-runbook.md](docs/19-amplify-release-runbook.md)) |

## Run locally
Requirements: Node ≥ 22.12, npm, a Supabase project with migrations `supabase/migrations/0001..0003` applied.

```bash
npm ci
cp .env.example .env.local   # fill values yourself; never commit
npm run env:check            # prints which variables are SET/UNSET (never values)
npm run dev                  # http://localhost:3000
```

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` (project origin), `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | everything |
| `SUPABASE_SERVICE_ROLE_KEY` (server only) | guest start/reset, quota, AI messages and proposals |
| `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_VISION_MODEL` (server only) | Assistant and receipt scan. Without them the app shows a clear "not configured" state; nothing is faked |
| `NEXT_PUBLIC_APP_URL` | same-origin checks and auth redirects |

## Scripts
| Command | What it does |
|---|---|
| `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` | quality gate |
| `npm run test:coverage` | finance engine coverage |
| `npm run test:e2e` | Playwright on a local production build; creates throwaway guests on the shared DB and deletes exactly those ids |
| `npm run test:rls` | live RLS/RPC/quota suites against the approved project only |
| `npm run ai:probe` | manual check that the configured model supports tools and vision (prints booleans only) |
| `npm run seed:demo` / `seed:demo:apply` | dry-run / apply the 3 sample email accounts ([docs/17](docs/17-demo-account-seeding.md)) |
| `npm run security:bundle` | after a build, checks that server secrets are not in the client bundle |
| `npm run gen:demo-fixtures` | regenerate bundled persona data from `mock-data/` |

## Project layout
```
src/app            pages (5 main routes + welcome/login/signup/onboarding) and API route handlers
src/features/*     page UIs (dashboard, transactions, assistant, simulator, settings, welcome, auth)
src/lib/finance    pure deterministic engine (no clock, network or env access; enforced by a test)
src/lib/ai         provider adapter, tool loop, tools, policy
src/lib/assistant  chat orchestration and proposal lifecycle
src/lib/db         Supabase clients, owner-scoped repositories, server-only privileged wrappers
supabase/          migrations (applied) and proposed/rollback scripts
tests/             unit, route, static SQL, live RLS (opt-in) and e2e
docs/              specs, reviews, approval packs, runbooks, evidence
```

## Security model (short)
Owner ids come only from the verified Supabase session (`requireOwner()`); request bodies with `user_id`/`owner` keys are rejected. RLS isolates every row by `auth.uid()`; anonymous guests are the `authenticated` role. Privileged RPCs (quota, reset, CSV commit) are executable by `service_role` only, and the service-role client is created only after the owner is verified. All mutating routes check the `Origin` header. Details: [docs/08-security.md](docs/08-security.md), evidence: [docs/evidence/ac-matrix.md](docs/evidence/ac-matrix.md).

## Third-party software, assets and AI tools
- Runtime dependencies (all MIT): next, react, react-dom, @supabase/supabase-js, @supabase/ssr, zod. Dev tools: TypeScript (Apache-2.0), ESLint (MIT), Vitest (MIT), Playwright (Apache-2.0), Tailwind CSS (MIT), fast-check (MIT).
- Fonts: Alata, Instrument Sans, Red Hat Mono via `next/font/google` (SIL Open Font License). Icons are inline SVG drawn for this project.
- Visual design reference: Google Stitch export in `design/stitch/exports/v1/` (reference only; UI rebuilt in React).
- AI tools used to build it: Kiro IDE (agentic coding) and Google Stitch (UI design). At runtime: the Gemini or OpenRouter model configured by the operator.
