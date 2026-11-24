# Kiro — Integrate Google Stitch Export (after G1 approval)

The owner has exported Google Stitch UI into `design/stitch/exports/<version>/`. First inspect `DESIGN.md`, actual screens, routes, HTML/CSS/component output and asset licensing. Build a **screen-to-route mapping** for Dashboard, Transactions, AI Assistant, Simulator, Settings, plus Welcome, Demo Picker, Login, Onboarding, preview sheets and confirmations. Identify reusable tokens/components; do not copy prototype logic as production truth.

Preserve Stitch's chosen visual language while wiring real Next.js/Supabase behavior and accessible mobile navigation. Do not introduce a sixth main page. Keep the user-approved relative button placement: profile top right; transactions + bottom right on mobile; chat composer bottom; simulator primary CTA below form; Settings edit controls within sections. Implement empty/loading/error/blocked AI states.

Before editing, list which existing files would be overwritten and request approval for destructive conflicts. After each main page integration run lint, typecheck and accessible mobile E2E where available. Never upload Stitch export somewhere else, push or deploy without explicit consent.
