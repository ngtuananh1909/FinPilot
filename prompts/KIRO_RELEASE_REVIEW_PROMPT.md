# Kiro — Independent MVP Audit / Release Readiness (no push or deploy)

Review code against `DECISIONS.md`, `.kiro/specs/finpilot-mvp/requirements.md` and `docs/09-testing-and-acceptance.md`. Check each AC-01..AC-18 with evidence, not assertion. Run permitted local lint, typecheck, tests and build. For RLS/integration tests requiring hosted DB mutation, request G2 approval or mark BLOCKED; never fabricate results.

Audit sensitive flows: guest/user isolation; correct snapshot balance; deterministic 45-day forecast and reserve minimum; CSV suspicious duplicates; receipt confirmation; Gemini/OpenRouter adapter with no leaked keys; read-only AI tools + proposed-write confirmations; guest quotas and concurrency; Amplify SSR environment/build compatibility.

Output: (1) matrix PASS/FAIL/BLOCKED with evidence location, (2) defects by severity and clear reproduction, (3) remediation plan, (4) estimated AWS/API cost risks, (5) exact release/rollback steps and target commit. Then **STOP and request G4 approval** before any git push/PR/merge/deploy.
