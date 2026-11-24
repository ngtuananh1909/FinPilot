# 04 · Architecture and Implementation Boundaries

## Stack (approved direction)
- **One full-stack Next.js + TypeScript** app, React UI, server route handlers. Kiro must pin a Next.js version verified compatible with **AWS Amplify SSR**; AWS documentation available at authoring lists versions through 15. Avoid unsupported version upgrades during MVP.
- **One Supabase project / PostgreSQL database** shared by local developers and Amplify-hosted judges. Supabase Auth anonymous + email/password; RLS for user data; Supabase Storage private bucket if retaining receipt images (MVP may process images in memory and discard to minimize risk).
- **AI provider adapter** supports Gemini native and OpenRouter/OpenAI-compatible HTTP. Exact provider/base URL/key/model filled later from server-side environment. Never expose AI secrets in client.
- **Hosting:** AWS Amplify, deploy from approved commits to `main`; HTTPS on Amplify domain; use $20 AWS credit only after verifying eligible services and expiry.

## Logical system topology

```mermaid
flowchart TD
  U[Guest and real users] --> A[AWS Amplify / Next.js UI and API]
  A --> SB[Supabase Auth + one PostgreSQL DB]
  A --> FE[Deterministic Financial Engine]
  A --> AO[AI Orchestrator]
  AO --> T[Allowlisted Finance Tools]
  T --> FE
  T --> SB
  AO --> P[Gemini or OpenRouter API]
```

## Deployment environments
- Local Next.js and Amplify website both use **the same** `NEXT_PUBLIC_SUPABASE_URL` and publishable key.
- No local-only runtime database, no staging DB. Unit tests should use pure functions and fixtures; hosted integration tests use disposable **user IDs** and must clean up only records they created, with approval for deletion.
- Remote migration and seed changes are **independently gated** from normal code edits.
- Separate credentials & user identities, not separate databases. SSR secrets only on server.

## Suggested implementation modules (adapt to actual Stitch export)

```text
src/
  app/                     # 5 main routes + auxiliary auth/entry
    api/                   # authenticated financial/AI/import endpoints
  components/              # accessible reusable UI based on Stitch
  features/
    dashboard/
    transactions/
    assistant/
    simulator/
    settings/
  lib/
    auth/                  # Supabase user session, never take owner id from form
    db/                    # Supabase clients, RLS-safe repository
    finance/               # pure BigInt-VND calculation / date operations
    ai/                    # provider adapter, tools, vision, proposal validation
    import/                # CSV parsing, mapping, fingerprinting
    validation/            # schemas and error handling
  types/
tests/
```

## Suggested API routes (contracts detailed in docs/05)
- `GET /api/finance/overview` → own snapshot, 45-day forecast and alerts.
- `GET/POST /api/transactions`; `PATCH/DELETE /api/transactions/:id`.
- `POST /api/imports/csv/preview`; `POST /api/imports/csv/commit`.
- `POST /api/receipts/extract`; `POST /api/receipts/confirm` or regular create transaction.
- `POST /api/simulations/purchase`.
- `POST /api/assistant/chat`; `POST /api/assistant/proposals/:id/approve|reject`.
- `POST /api/demo/start|reset` (authenticated anonymous user; prevents reusing someone else's state).

## Core data trust boundaries
- Browser can call Supabase with public publishable key **only with appropriate user JWT and RLS**; operations requiring admin rights, AI key, usage quota, or proposal validation go through Next.js server.
- Server auth: derive `user_id` from verified Supabase session/JWT; never from body/URL. Service-role Supabase client bypasses RLS and is **only** allowed in narrowly scoped server functions after ownership checks.
- AI tools accept validated typed arguments and resolved user context from server, never an LLM-provided owner ID. Tool results are structured and may include provenance/assumptions.
- CSV/images can be malicious or contain prompt injection: treat as untrusted data, do not follow instructions embedded in receipt text.

## Forecast conventions
Calculation uses one timezone (Asia/Ho_Chi_Minh) and a daily bucket representation. Actual balance snapshot is not a bank-connected balance: label it estimated. All money integer VND; SQL BIGINT and TypeScript bigint/string JSON boundary. Tool results are produced by deterministic engine, not inferred by LLM.

## Diagram of approval boundaries
- Local code generation after approved implementation plan.
- Remote Supabase changes only after specific approval.
- Push/PR/merge/Amplify deploy only after separate explicit release approval.
- Use read-only checks and dry-run when possible; print exact environment target and commands before hosted mutations.
