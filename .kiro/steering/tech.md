---
inclusion: always
---
# Technical Steering

Next.js full stack (TypeScript strict; verify and pin AWS Amplify SSR compatible version), React client, server route handlers, **one shared Supabase project** (PostgreSQL, Auth anonymous/email, RLS), AWS Amplify Hosting. AI via configurable provider adapter (`gemini`/`openrouter`) using `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_VISION_MODEL`. All secrets server-side.

Use integer VND (Postgres bigint; JS bigint/string over JSON), Asia/Ho_Chi_Minh daily buckets; deterministic finance module. LLM tool results are validated typed data. Three synthetic persona data fixtures seed **into** Supabase, never form a second runtime database. Keep minimal dependencies and comprehensive financial/RLS tests.

See `docs/04-architecture.md`, `docs/05-data-contracts.md`, `docs/06-financial-engine.md`, `docs/07-ai-provider-adapter.md`.
