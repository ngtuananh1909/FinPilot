# 02 · Page-by-page Functional Specifications

All amounts: VND integer, formatted `vi-VN`; dates: Asia/Ho_Chi_Minh; empty/error/loading states on each page; no LLM-generated monetary arithmetic.

## 0. Auxiliary entry / onboarding (not a sixth main page)
- Welcome: CTA **Trải nghiệm demo** and **Đăng nhập**; optional **Đăng ký**. No forced signup.
- Guest chooser: 3 persona cards with concise financial circumstances. Selecting creates **new anonymous Supabase Auth identity**, then copies selected seed into user's isolated rows (idempotency key) and routes to Dashboard. If an anonymous session already exists, offer resume/reset/switch persona with clear confirmation; do not silently replace records.
- Real user: email/password auth and 2-step optional profile: current balance + effective timestamp, monthly payday/expected pay, recurring costs, estimated variable spend and reserve. If skipped, forecast displays explicit incomplete state.
- Guest badge always visible; Guest Reset asks confirmation, resets **only current guest's records** to chosen persona using safe scoped transaction; cannot reset other user data.

## 1. Dashboard (`/dashboard`)
- Header/logo left, avatar & Settings right; context badge `Demo` if guest.
- Above fold: estimated current balance with “as-of” date, monthly income/expenses, cash available after reserve, data completeness caveat.
- Prioritized: AI insight (cash shortfall/overspending), link to explanation/Assistant, 45-day cashflow chart, upcoming recurring items, transaction list snippet with View All.
- Data: financial_profile, transactions, recurring_items, savings_goal, deterministic projection. Chart line marks 0 and minimum-reserve threshold; show uncertainty clearly.
- Empty: prompt add transaction/profile; error: retry with diagnostics, never display fabricated balance.

## 2. Transactions (`/transactions`)
- List grouped by date, searchable/filterable by kind/category/time; show amount/category/source/merchant.
- Prominent floating `+` on mobile opens choices: manual, CSV, receipt scan; desktop equivalent top right.
- Manual form: kind `income|expense|excluded`, positive VND amount, date, category, merchant/description, optional link to recurring item; validate and show save feedback.
- Edit/delete have user confirmation for destructive changes; owner only; refunds/transfers marked excluded when not changing personal budget totals.
- CSV: upload max 2 MB, parse safe header mapping, preview normalized dates/amounts/kinds, mark invalid/possible duplicate rows. User chooses include/exclude; **no DB write until confirmation**. No silent global reset.
- Receipt: image max 5 MB, request AI vision extraction (merchant/date/total), user reviews & edits, then explicitly saves; no fake OCR if provider unavailable.
- Loading/empty/partial-import/error states; prevent accidental repeated submit via idempotency keys and disabled submit during save.

## 3. AI Assistant (`/assistant`)
- Chat history with suggested prompts: "Tôi có đủ tiền đóng trọ không?", "Tại sao chi tiêu tuần này tăng?", "Mua bàn phím 1,5 triệu hôm nay có ổn không?".
- Composer pinned near bottom on mobile; attached result cards for calculations and action proposals.
- The AI calls **read-only finance tools** `get_financial_snapshot`, `list_transactions`, `forecast_cashflow`, `simulate_purchase`, `get_savings_goal`, `get_spending_breakdown` (server validates every tool's user scope).
- Answers cite source data or assumptions and distinguish estimate from fact. If missing data, ask relevant single follow-up or state uncertainty.
- AI may propose only a budget estimate update or savings-goal modification. Render diff + reason + **Confirm/Cancel**. No write from text alone; server validates user, proposal expiration, content and latest record state.
- Limits for guest: 20 user chat requests per local day (not each internal tool call). State quota remaining/limit; prevent abuse as feasible.
- AI timeout/errors yield retryable explicit error, no simulated successful tool output.

## 4. Simulator (`/simulator`)
- Input top: item name (optional), purchase cost VND (required), buy-now date, buy-later choice (`next payday` or selected date within 45-day horizon), reserve minimum from Settings (modifiable via link, not silently).
- Main action **Mô phỏng**. Two scenario cards: Buy Now, Buy Later; chart with daily projected balance both scenarios over common 45-day window, show lowest balance, date it occurs, end balance, reserve violation count.
- Safe flag only if min daily projected balance >= reserve and >= 0 for entire evaluation period. If both unsafe, say so; propose postponing/reducing purchase, but never guarantee affordability.
- No historical transaction double count; no expected income double count when already posted. Dates outside window prompt extension/reselection rather than presenting false comparison.
- Link to Assistant for explanation of trade-offs. The engine calculates; AI only explains.

## 5. Settings (`/settings`)
- Accessible via avatar on mobile, sidebar on desktop. Editable cards: financial snapshot (value + as-of time), payday + monthly expected income, recurring expenses/income, estimated daily variable expense / projected monthly budget, minimum reserve, **one active savings goal** (name, target, deadline, current saved amount).
- Account section: Guest reset/switch persona or email login/logout; plain explanation of data privacy and how to delete account/data when available.
- Changes validate values, show immediate feedback and update all dependent projections.
- Profile changes that overwrite snapshot timestamp should be explicit; do not silently rebase historical transactions.

## Shared UI behavior
- Mobile bottom tabs: Home, Thu chi, AI, Mô phỏng; Settings via top avatar. Desktop left sidebar with five main routes.
- Loading skeletons, empty illustrations/messages, validation field errors, retry buttons, toast notifications; keyboard accessibility, chart textual summaries, 44px-ish tap targets.
- Stitch chooses aesthetics, components, spacing and precise colors, constrained only by light/mobile-first and content/placement above.
