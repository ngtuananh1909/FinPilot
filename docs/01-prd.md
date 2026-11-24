# 01 · Product Requirements Document (PRD)

## Product & contest alignment
**FinPilot AI** is an AI-powered personal-finance copilot helping Vietnamese students and early-career workers understand spending, anticipate near-term cash shortages, and compare the consequences of buying now versus buying later. It addresses the contest's **AI Assistant** track. The product must be live online, independently usable by judges and powered by real AI, not only static mockups.

## Problem & primary jobs
- **Know:** “How much money do I have, and where did it go?”
- **Predict:** “Can I cover upcoming bills for the next 45 days?”
- **Decide:** “Can I afford this purchase today or after payday while keeping a reserve?”
- **Act with control:** “Suggest a more realistic variable spending budget or savings goal; let me approve before saving.”

## Audience and demo persona roles
1. Student (living allowance, rent/food/education; goal e.g. new laptop).
2. New worker (salary, recurring costs, buffer; goal emergency savings).
3. At-risk cash flow (upcoming obligations and discretionary spending; warning scenarios).

## MVP success definition
- 5 fully functional routes, responsive mobile-to-desktop, with welcome/login/onboarding as auxiliary screens.
- Guest demo from any persona + 3 demo login accounts, using **one shared Supabase DB** with RLS isolation.
- Manual/CSV/OCR transaction capture; validated preview on both import paths.
- Deterministic current balance and daily 45-day projection; rule-based unusual spending warnings.
- Chat with tool calling for user-specific facts; structured sourced explanations, proposals requiring confirmation.
- Buy-now and buy-later side-by-side results, minimum balance **during** period and user-configured reserve.
- Deployed AWS Amplify URL accessible without local devices, with no critical errors in demo E2E.

## Product principles
- AI *supports* decisions; never directly initiates payments or guarantees safe purchase outcomes.
- Financial arithmetic is server-side, reproducible and integer-VND based; LLM never invents money values.
- User controls writes; previews are editable; mistakes and missing data are disclosed.
- Gracefully handle sparse/empty data, model errors, missing credentials, rate limits and export mismatches.
- One main goal in Settings; no gratuitous pages or feature creep.

## Screen inventory
Main: `/dashboard`, `/transactions`, `/assistant`, `/simulator`, `/settings`. Auxiliary: `/` welcome/persona chooser, `/login`, `/signup` (if email registration enabled), a brief onboarding flow, receipt/CSV preview dialogs and confirmation cards. Main five navigation remains stable; auxiliary screens do not count as additional main pages.

## Submission readiness (contest)
- Public running product and judge demo login/guest instructions.
- One-page A4 **PDF usage guide** with product link/login if required (to be created once actual URL exists).
- Source ZIP + README including setup/stack/third-party assets/open-source/AI tools.
- Max 10-slide PDF describing problem and solution; must be frozen before submission.
- MP4 video **up to 3 min** filmed using actual running product, not fake UI.
- Submission freeze requires explicit user approval; no changing live demo after cutoff.

## Non-goals
No real bank integration, wallet payment, fraud-detection claims, app-specific savings investment advice, bank credentials, background automatic financial action, external admin portal, push notifications, long-range ML forecasts or second database.

## Dependencies & actual decisions
AWS Amplify and one Supabase DB are approved; actual provider endpoint/key/model, account credentials and repo-specific version pins are deferred to implementation-time configuration, not business scope.
