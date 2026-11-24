# Google Stitch · FinPilot AI MVP — MASTER PROMPT (Copy into Stitch)

Design a coherent **mobile-first, responsive** web app UI for **FinPilot AI**, a Vietnamese AI personal-finance copilot for students and early-career employees. The app helps users record expenses, forecast their next 45 days of cashflow, ask an AI assistant about their money and compare buying an item now versus later. It is a practical fintech MVP, not a marketing-only prototype.

Please design **exactly five main app pages**, plus compact supporting Welcome/Demo Picker/Login/Onboarding screens and key modals/sheets. Main UI copy should be **Vietnamese**. Keep a clean **light** visual direction with white and purple/blue accents, but **you are free to choose the design system, fonts, colors, visual hierarchy, illustrations, card shapes, spacing, charts and interactions**. Please create a polished, consistent experience. Do not invent unrelated pages or features.

### Global navigation and responsive structure
- **Mobile:** a fixed bottom navigation with 4 tabs: **Home, Thu chi, AI, Mô phỏng**. Place an **avatar/profile button at the top-right** to open **Settings**.
- **Desktop:** a left sidebar with five items: Dashboard, Transactions, AI Assistant, Simulator, Settings; display content in an adaptive main area.
- Use realistic Vietnamese text and clearly recognizable sample VND amounts. Ensure touch-friendly controls, clear validation and loading/empty/error states.

### Page 1 — Dashboard (`/dashboard`)
- Header with FinPilot logo/name on the left, **profile/avatar on top-right**, optional Guest Demo label.
- Prominent **current estimated balance** and compact income/expense summary near the top.
- Below it, a visible **AI Insight/warning card** with a **“Hỏi FinPilot” or “Xem phân tích” button**.
- Include a **45-day projected cashflow chart**, next recurring bills/income, and a recent-transactions list with a **“Xem tất cả”** link to Transactions.
- The AI insight should clearly look like an estimate, not a guaranteed prediction.

### Page 2 — Transactions (`/transactions`)
- Top: page title, **search and filter controls** (date, category, income/expense).
- Main: easy-to-scan transactions grouped by day, with amount, category and merchant.
- Prominent floating **“+” button near bottom-right on mobile**; top-right action on desktop.
- When tapped, offer **“Thêm thủ công”**, **“Nhập CSV”**, **“Quét hóa đơn AI”**.
- Supporting UI: manual transaction form; CSV import preview with column mapping, duplicate warnings and **Confirm Import** button; scan result preview with editable merchant/date/total and **Save** button.

### Page 3 — AI Assistant (`/assistant`)
- Chat layout with welcome prompt suggestions at the top/empty state; conversation messages in the main area.
- **Text input/composer pinned toward the bottom**, Send button beside it.
- Example prompt chips: “Tôi còn đủ tiền đóng trọ không?”, “Tháng này tôi tiêu nhiều ở đâu?”, “Tôi có nên mua bàn phím 1,5 triệu?”.
- Show beautiful **tool result cards** for forecast/spending breakdown/simulation, including sources/assumptions.
- Show a clear **proposal card with old/new values and “Xác nhận” / “Hủy” buttons**. AI must not appear to transfer money or edit data autonomously.

### Page 4 — Simulator (`/simulator`)
- At top: compact form with **item name**, **price**, **buy now / buy later date**, and visible **“Mô phỏng” primary button beneath the form**.
- In results: compare **two cards side by side on desktop / stacked on mobile**: “Mua ngay” vs “Mua sau”, with minimum projected balance, end balance, reserve warnings, and plain-language insights.
- Below: **45-day comparison chart/timeline** and a **“Giải thích bằng AI”** action that opens Assistant.
- Include the user's **minimum reserve** and distinguish safe from risky without pretending to guarantee future finances.

### Page 5 — Settings (`/settings`)
- Clear sections/cards for **financial profile + current balance snapshot**, **salary/allowance and payday**, **monthly recurring bills**, **expected variable spending + minimum reserve**, **one savings goal**, and **account/session**.
- Put **Edit** controls in each section; **Save/Cancel** in forms. Guest users get a visible **Reset Demo** action with confirmation.
- No separate Savings Goal page; savings goal lives in Settings.

### Supporting flows (not new main nav pages)
- Simple Welcome with two CTAs: **“Trải nghiệm demo”** and **“Đăng nhập”**.
- Demo persona chooser with 3 cards: Sinh viên, Người mới đi làm, Dòng tiền cần chú ý.
- Email/password login and compact financial setup/onboarding.
- CSV review, AI receipt review, proposal confirmation, Guest Reset confirmation.

Please keep all five pages and supporting screens visually consistent and connected. **Take ownership of visual design choices yourself**; the only fixed requirements are page purpose, key content, relative button positions, navigation and the light/mobile-first direction above. Include screen designs useful for an implementation agent and export design/code assets and `DESIGN.md` if Stitch supports that export.
