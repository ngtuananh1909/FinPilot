# 12 · Configurations to Provide Later (No New Scope Approval Needed)

User explicitly deferred selecting exact AI model, API key and API Base URL until Kiro implementation. Prepare placeholders only.

| Field | When needed | Who supplies |
|---|---|---|
| `AI_PROVIDER` | First genuine AI integration test | User: `gemini` or `openrouter` |
| `AI_BASE_URL` | First genuine AI integration test | User, validated against provider docs |
| `AI_API_KEY` | First genuine AI integration test | User, server secret only |
| `AI_MODEL` | Tool/chat testing | User; must support selected tool schema |
| `AI_VISION_MODEL` | Receipt scan testing | User; validate image support |
| `NEXT_PUBLIC_SUPABASE_URL` | Initial database connectivity | User's single Supabase project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Initial database connectivity | User's single Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin-only quota/seed route implementation | User as secure server/admin secret; avoid if no admin functionality needed |
| Three demo user email/password pairs | Authorized seed step | User, never in source files |
| AWS account/Amplify app and credit | Authorized deployment step | User |
| Final Amplify URL | Post-deploy Auth redirects & submission guide | Assigned by AWS |

## Decisions delegated to engineering (must document actual chosen value)
- Pin Next.js version compatible with Amplify, Node runtime, React/Supabase SDK versions.
- Normalize provider-specific chat and image/tool formats, test capabilities.
- Implementation of guest session time-limit: in-app expiry only until user explicitly approves server-side cleanup.
- Visual detailing (components/colors/spacing) to Stitch; maintain accessibility and light theme direction.

## Configuration and rollback rule
If a configured AI provider does not support both vision and tools, use separate `AI_MODEL` / `AI_VISION_MODEL` where supported or explain model requirement; do not invent model support. No dynamic paid fallback provider without user agreement. All missing configurations must trigger useful error messages rather than fake success.
