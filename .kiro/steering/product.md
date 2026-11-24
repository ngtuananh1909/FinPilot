---
inclusion: always
---
# Product Steering — FinPilot AI

FinPilot AI is a 5-page, Vietnamese, mobile-first personal-finance decision copilot for students and early-career workers. Read `DECISIONS.md` and `docs/01-prd.md` as authoritative business scope. Pages: Dashboard, Transactions, AI Assistant, Simulator, Settings. Guest Demo and 3 optional sample email/password accounts. Light theme; Stitch chooses details.

Success = usable online with real tool-calling AI + real data in one Supabase DB, deterministic 45-day financial engine, import/receipt confirmation, buy-now/later simulator and minimum reserve safety. No payments or actual bank access.

Never silently add features/pages, replace real AI with mocks in deployed demo or claim unmeasured accuracy. Do not treat product spec approval as approval to code, mutate remote DB, push or deploy.
