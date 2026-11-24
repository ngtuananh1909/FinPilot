---
inclusion: always
---
# Structure Steering

Reserve `docs/` for approved specifications, `.kiro/specs/finpilot-mvp/` for requirements/design/tasks, `mock-data/` for synthetic seed source, `supabase/migrations/` for reviewed SQL, `prompts/` for manual human-run prompts, `design/stitch/exports/` for raw Stitch exports.

When implementing, prefer `src/app` route handlers/pages, `src/features/<page>`, `src/components`, `src/lib/finance`, `src/lib/ai`, `src/lib/auth`, `src/lib/db`, `src/lib/import`, `tests/`. Adjust only after actual repository inspection and explicit plan approval. No blind source replacement by Stitch-generated code. Keep tests adjacent or under `tests/`; separate pure finance calculations from provider/network code.
