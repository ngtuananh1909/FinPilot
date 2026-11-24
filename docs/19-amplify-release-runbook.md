# 19 · AWS Amplify release runbook (preparation only, nothing executed)

> Status 2026-11-24: **not deployed.** No AWS resource, Amplify app, GitHub remote or hosted environment variable has been created or changed by the agent. Every step below is an owner action, and the push to `main` needs explicit G4 approval.

## 0. Facts this runbook relies on
- Amplify Hosting compute supports Next.js SSR for versions 12 through 15 ([AWS docs](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-amplify-support.html)). The app pins **Next.js 15.5.29**. Do not upgrade to 16.
- Unsupported on Amplify, and not used by the app: Next.js streaming, Edge API routes, `unstable_after`, on-demand ISR. A static test (`tests/security/routes-static.test.ts`) enforces Node runtime and no streaming on every route.
- Server components do not see console environment variables by default. AWS documents writing them into `.env.production` in the build step ([AWS docs](https://docs.aws.amazon.com/amplify/latest/userguide/ssr-environment-variables.html)). `amplify.yml` in the repo root does this without printing values.
- AWS warns that anyone with access to deployment artifacts can read such variables. This is a known limitation of this simple setup. Keep the Amplify console access limited to the owner.
- Node version: the Amazon Linux 2023 build image ships Node 18/20; `amplify.yml` runs `nvm install 22`. **Unverified** until the first build: if `nvm install 22` fails, change it to `nvm use 20` (Next 15 runs on Node 20; only the local test runner needs 22).

## 1. Before connecting the repo
1. Create the GitHub repository (private recommended) and add it as `origin` locally. The agent has not done this.
2. Confirm `.env.local`, `.env`, `test-results/` and `playwright-report/` are not committed (`git status --ignored`); `.gitignore` already excludes them. `docs/evidence/screenshots/` contains only synthetic demo data and is meant to be committed as evidence.
3. Fix `NEXT_PUBLIC_SUPABASE_URL` to the project **origin** `https://llrxhefrqnjdwlmxozul.supabase.co` (the current local value ends with `/rest/v1/`; the app normalises it, but use the clean value on Amplify).
4. Set an AWS Budget alert (for example USD 5 and USD 15) and check that the USD 20 contest credit covers Amplify Hosting build minutes, SSR compute and data transfer, and its expiry date.

## 2. Amplify app (owner, in the AWS console)
1. Amplify → Create new app → GitHub → select the repo and branch `main`.
2. Framework detected: Next.js SSR. Keep the repo `amplify.yml` (do not let the console replace it).
3. **Disable auto build** until the first push is approved, or connect only after approval.

## 3. Environment variables (Amplify console → Hosting → Environment variables)
Enter values in the console only. Never paste them into chat, tickets or the repo.

| Name | Value source | Exposure |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://llrxhefrqnjdwlmxozul.supabase.co` | public (browser) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → API Keys | public (browser, RLS protects data) |
| `NEXT_PUBLIC_APP_URL` | the Amplify URL, e.g. `https://main.<id>.amplifyapp.com` | public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API Keys (secret) | **server only** |
| `AI_PROVIDER` | `gemini` or `openrouter` | server only |
| `AI_BASE_URL` | provider OpenAI-compatible base URL | server only |
| `AI_API_KEY` | provider key; set a spend cap at the provider | **server only** |
| `AI_MODEL`, `AI_VISION_MODEL` | models that support tools / images | server only |
| `GUEST_CHAT_DAILY_LIMIT`, `GUEST_SCAN_DAILY_LIMIT` | `20`, `5` | server only |

Do **not** add `SEED_*` or `RLS_TEST_*` variables to Amplify.

## 4. Supabase Auth settings for the hosted URL (owner, Supabase dashboard)
- Authentication → URL Configuration: **Site URL** = the Amplify URL; **Redirect URLs** add `https://<amplify-domain>/auth/callback` and keep `http://localhost:3000/**`.
- Confirm Anonymous sign-ins stay enabled (guest demo) and consider enabling the built-in CAPTCHA / rate limits for anonymous sign-ins (the guest quota can be bypassed by creating new anonymous identities; deferred by owner).

## 5. Release (G4, requires explicit approval of this exact action)
```bash
git push -u origin main   # Amplify auto-builds main after this
```
Then watch the build log: `node --version` must print v22 (or v20 if you changed it), `npm run build` must succeed.

## 6. Post-deploy smoke test (owner or agent after URL is shared)
1. `https://<url>/` loads over HTTPS on a phone and a laptop.
2. Guest: pick each persona → Dashboard shows balance, 45-day chart, alerts.
3. Add a manual transaction; run the simulator; import a small CSV.
4. Assistant: ask "Tôi có đủ tiền đóng trọ không?" → answer with tool evidence; quota decreases by one.
5. Receipt scan with a sample receipt photo → edit → save once.
6. Settings: reset demo with confirmation.
7. Email login with each of the 3 demo accounts (after they are seeded).
8. Run `npm run security:bundle` against the deployed build output if available, and check the browser Network tab shows no `SUPABASE_SERVICE_ROLE_KEY` / `AI_API_KEY`.

## 6b. Request duration risk (unverified on Amplify)
One chat turn can make up to 4 model calls. Measured locally: Gemini `gemini-3.5-flash-lite` about 10 s per turn; OpenRouter `nemotron-3.5-super-vl:free` about 24 s per turn and about 16 s per receipt. Community reports suggest Amplify SSR requests may be cut off around 30 s; AWS does not state a figure on the pages checked. Measure on the deployed URL during the smoke test; if requests are cut off, use the faster model or lower `AI_MAX_TOOL_STEPS`.

## 7. Rollback
- Amplify keeps previous deployments: Hosting → Deployments → redeploy the last good build, or revert the commit and push (G4 again).
- Database rollback scripts: `supabase/proposed/*rollback*.sql` (only with a separate G2 approval).
- Disable AI quickly by removing `AI_API_KEY` in the console and redeploying; the app then shows the "not configured" state everywhere and non-AI pages keep working.
