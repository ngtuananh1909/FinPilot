# Kiro Project Integration

Steering files use Kiro's `inclusion: always` frontmatter. Kiro IDE detects `AGENTS.md` at repo root. Specs use canonical `.kiro/specs/finpilot-mvp/{requirements,design,tasks}.md` names.

**Recommended workflow:** open workspace → read docs and Stitch export → submit the bootstrap prompt → require user approval for repository-specific implementation plan → implement approved tasks in dependency order → test/review → request specific approval for remote DB changes, git push and AWS deploy. Do not use Quick Spec to bypass phase gates.

Model Auto may choose code-generation model where supported, but it does not change authority/approval rules or the app's separately configured AI provider.

Hooks are deliberately not pre-installed: automatic file-change or deployment hooks may be unsafe with a shared Supabase DB. Agent may propose harmless local lint/test hooks after inspecting installed Kiro hooks schema and asking user approval. See https://kiro.dev/docs/steering/ and https://kiro.dev/docs/specs/.
