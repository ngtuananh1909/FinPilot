# Workspace AI Agent Contract — FinPilot AI

Kiro Model Auto, any other agent and human contributors must follow this contract.

## Mandatory start-up order
Read `DECISIONS.md`, `docs/01-prd.md`, `docs/02-page-specs.md`, `docs/04-architecture.md`, `docs/05-data-contracts.md`, `docs/06-financial-engine.md`, `docs/07-ai-provider-adapter.md`, `docs/08-security.md`, `.kiro/specs/finpilot-mvp/{requirements,design,tasks}.md`, and available Stitch design exports. Inspect **actual files** before proposing modifications.

## Priority & stopping rules
- Do not infer that documentation approval authorizes implementation; first propose repo-specific task plan and wait for approval.
- Stop on ambiguous business rules, credentials, irreconcilable Stitch conflicts, destructive change, unauthorized push/PR, remote migration, seed, deployment, or paid infrastructure changes.
- Before any remote Supabase write: describe exact SQL/script and affected tables; ask for user approval with rollback. Shared dev+BGK database is sensitive.
- Do not claim success from mocked responses; clearly label demo fixtures. AI must invoke functioning tools for data-backed answers.
- No real financial advice promises, payment initiation or customer bank access.

## Code quality
TypeScript strict, cohesive small components, descriptive names, schema validation at boundaries, input validation, integer VND, safe date handling in Asia/Ho_Chi_Minh, accessible mobile UI, clear loading/error states. No gratuitous dependencies. Tests accompany calculations, RLS, auth, AI tool approvals and CSV/vision imports. Show command output and failures in handoff.

## Design flow
Stitch output is a **visual reference**. Place export in `design/stitch/exports/<version>/`. Reuse layout and design tokens where reasonable, but implement behavior, responsive UI, security and business rules from approved documents. Do not overwrite application code with Stitch-generated prototype source blindly.

## Change/release review gates
G0 scope approved; G1 approve implementation plan; G2 separately approve each remote DB mutation/seed/reset; G3 code+tests+review; G4 explicit approval before push, PR, merge, Amplify deployment or modifying infrastructure. For local destructive file operations, ask before delete and prefer backup/move.

## Safety prohibition examples
Do not run `supabase db reset --remote`, `DROP TABLE`, broad `DELETE`, `TRUNCATE`, `supabase db push --remote`, `git push`, `gh pr create`, `aws amplify ...`, or create paid resources without explicit permission for that exact operation. Read-only CLI inspection and dry-run can be used after checking credentials and target.
<!-- BEGIN PORTABLE-AGENT-SKILLS PERSONAL-CONTEXT (MANAGED) -->
## Mandatory Local Personal-Context Bootstrap

The user EXPLICITLY AUTHORIZES reading the confirmed low-sensitivity personal context files below for cloud AI sessions.
Whenever starting a new session or pulling project context, the AI MUST ALWAYS automatically read the following files if they exist:
- ~/.Vault/AI-START-HERE.md
- ~/.Vault/00-Meta/ai-interaction-rules.md
- ~/.Vault/02-Preferences/coding-standards.md
- ~/.Vault/02-Preferences/learning-style.md
- ~/.Vault/07-Environment/arch-linux-setup.md
- ~/.Vault/07-Environment/windows-setup.md

Do NOT ask for confirmation before reading these specific low-sensitivity files. Never read Identity, private Projects, Journal, or secrets.
<!-- END PORTABLE-AGENT-SKILLS PERSONAL-CONTEXT (MANAGED) -->