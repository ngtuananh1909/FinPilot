# Final Decision Matrix · FinPilot AI MVP v1.0

**Approved by user: 2026-11-23.** This matrix overrides earlier provisional choices when conflicting. No new product features without explicit approval.

| ID | Domain | Final approved decision |
|---|---|---|
| D01 | Audience | Both students and early-career workers in Vietnam |
| D02 | Main pages | Dashboard, Transactions, AI Assistant, Simulator, Settings; exactly 5 main pages |
| D03 | Entry | Guest Demo + optional Supabase Email/Password login |
| D04 | Demo | 3 independent guest personas **and** 3 optional demo login accounts |
| D05 | Input | Manual transactions, CSV with column mapping and duplicate review, AI receipt scan with editable confirmation |
| D06 | Assistant | Real LLM tool calling for user-specific finance; proposes actions; no write without user confirmation |
| D07 | Simulator | Buy now vs buy later (next payday or chosen future date); must preserve minimum cash reserve |
| D08 | Goals | Exactly one active savings goal within Settings (no Goals page) |
| D09 | Responsive | Mobile-first; bottom tabs Home, Thu chi, AI, Mô phỏng; Settings through profile avatar; responsive desktop |
| D10 | Visual | Light background with white + purple/blue direction; Stitch independently designs visual details |
| D11 | Balance | Date/time-specific current-balance snapshot; prior transactions only inform analytics, not double counted |
| D12 | Sparse data | Fallback to recurring bills + user-estimated daily variable expense |
| D13 | Guest lifecycle | Isolated time-limited anonymous session; reset **only own records** from persona template |
| D14 | Categorization | Rules first; AI only for ambiguity; user can correct |
| D15 | Duplicate handling | Suspected duplicate CSV rows require user review; never silent drop or silent duplicate import |
| D16 | Purchase safety | Projected balance never below zero **and** never below user-defined minimum reserve over evaluated period |
| D17 | Recurrence | Monthly; days 29–31 clamp to end of shorter months; reconcile confirmed occurrences |
| D18 | AI editable proposals | Projected budget and savings goal only; explicit review and confirm before server write |
| D19 | Dashboard | Snapshot/summary, 45-day forecast and alerts; useful first glance |
| D20 | Transactions | Income / expense / excluded transfers; no multi-wallet accounting in MVP |
| D21 | Scan extraction | Merchant, transaction date, total VND, optional description/category; preview then commit |
| D22 | Forecast | Recurrences + history-based average; deterministic computation, AI only explains |
| D23 | Warnings | Rule-based unusual spending; avoid claiming fraud detection |
| D24 | Runtime | One Next.js full-stack app (version explicitly compatible with Amplify), TypeScript, server API routes |
| D25 | Hosting | AWS Amplify Hosting (contest AWS infrastructure credit $20; confirm exact coverage) |
| D26 | DB | **Exactly ONE Supabase project / PostgreSQL database shared between local dev and judges** |
| D27 | Auth | Supabase Auth anonymous Guest + email/password account; RLS owner isolation |
| D28 | Seed | CSV/JSON are seed-only fixtures; production runtime reads Supabase |
| D29 | AI provider | Provider adapter with `AI_PROVIDER`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_VISION_MODEL`; Gemini preferred but exact endpoint/model may be selected later; OpenRouter supported |
| D30 | Forecast window | 45 days from user's current local day (Asia/Ho_Chi_Minh) |
| D31 | Guest quota | At most 20 chat turns + 5 receipt scans per **Asia/Ho_Chi_Minh** calendar day, enforced server-side |
| D32 | Release | Test → ask permission before push; only approved push to `main` causes Amplify auto-deploy |
| D33 | Kiro | Model Auto as available; instructions and review gates remain model-independent |

## Out of scope (must not creep in)
Bank account integration, real payment transfers, automated spending on behalf of user, multi-wallet reconciliation, custom ML training, fraud scoring, push/email notification infrastructure, admin analytics portal, separate Goals page, second DB, Kubernetes/microservices, sharing real users' financial data.

## Delegated implementation-time configuration (not a new approval round)
- User will provide actual API base URL/key/model and Supabase/AWS credentials later. **Never put real secrets in docs or version control**.
- Actual Next.js and SDK versions: Kiro verifies AWS compatibility and pins versions in a repository-specific plan.
- Date/time, amounts, and test persona transaction samples are synthetic; realistic balances must reconcile by design.
- Upload size defaults to **5 MB per receipt, 2 MB per CSV** until user changes; server-side enforcement required.
- Demo-session TTL proposal: **24 hours idle / 7 days maximum**, subject to user approval before enabling cleanup that deletes records.
- UI micro-interactions, imagery, typography and precise colors: delegated to Stitch.

## Contradiction resolution
1. This matrix > approved specs > diagrams/mockup > generated Stitch code > AI suggestions.
2. Shared Supabase does not mean shared user records: all guest/user rows are isolated by Auth user ID and RLS.
3. CSV/JSON are seed/import formats only; neither acts as a runtime database.
4. AI analyses may be probabilistic, but financial arithmetic is deterministic.
5. No push/deploy/migration/reset implicit approval arises from approval of these documents.
