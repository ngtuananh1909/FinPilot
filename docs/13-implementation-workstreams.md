# 13 · Task Dependencies and Release Strategy

This pack supplies Kiro tasks, not a fixed time promise or authorization to execute them.

## Priority dependency graph
1. Repo inspection + Stitch export review + G1 plan approval.
2. Next.js foundation + Supabase Auth/RLS/schema + deterministic finance engine (can develop finance engine locally without DB).
3. Seed fixtures + authorized 3 sample accounts + guest clone/reset flows.
4. Transactions CRUD and CSV preview/commit.
5. Dashboard and Simulator on real authenticated data.
6. AI adapter + tools + receipt vision + quota/proposals.
7. End-to-end regression, RLS/adversarial review, demo script, AWS deploy (after G4 approval).

## MVP risk-based trade-offs (if time pressure)
- Never cut ownership/RLS, deterministic calculations, confirmed writes, or actual AI calling; these define correctness.
- Simplify visual charts rather than remove data validation.
- Keep a minimal CSV mapping UI instead of bank-specific parsing.
- If AI receipt model fails, surface an honest blocked state while retaining manual input; do not fake scan.
- Avoid unapproved redesigns, second DB and additional infrastructure.

## Acceptance signoff groups
- Product owner: demo flow, five-page usability, clean simulated data.
- Agent code review: types, tests, minimal dependencies, no silent failures.
- Security review: RLS + service-role + quota/guest isolation.
- Infrastructure: compatible Amplify build and public smoke test only after approval.
