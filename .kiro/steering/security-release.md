---
inclusion: always
---
# Security & Approval Gates (Non-negotiable)

1. Read existing repo and present implementation plan; **wait for user approval before implementation**.
2. **One Supabase DB** for local dev and judges: avoid destructive migration or broad cleanup. Before *each* remote mutation/seed, report exact scope, dry-run, backup and rollback; wait for user approval.
3. Never call remote reset, drop/truncate, unscoped deletes or unauthorized auth admin creation.
4. Authenticate each route; owner-isolated Supabase RLS for all user data; anonymous Auth user is a Supabase `authenticated` role. Service key only server-side after verifying owner.
5. AI proposals do not mutate until a separate explicit user confirmation. Verify quota atomically.
6. Never `git push`, create/merge PR, deploy, create AWS cost-bearing resources or change hosted environment without approval for that specific action. Approved main push may trigger Amplify auto-deploy.
7. Unit/integration/E2E, security review and evidence required. Report blocked steps rather than faking execution.
