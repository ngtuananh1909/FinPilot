---
name: "FinPilot AI — Design System"
description: "Clean, high-trust light fintech design system with indigo-violet and sky-blue accents for Vietnamese personal finance."
---

## Overview

FinPilot AI is a Vietnamese AI personal-finance copilot built for university students and early-career employees. The interface feels calm, trustworthy, and practical—never flashy or speculative. A crisp white and cool-lavender-tinted light surface hierarchy pairs with deep indigo-violet primary actions and clear blue secondary accents, keeping balances, 45-day cashflow forecasts, and AI estimates immediately scannable on both mobile and desktop.

## Colors

The palette anchors on a deep Indigo-Violet (`#3525CD`) primary for main actions and focus states, paired with a Cobalt Blue (`#0051D5`) secondary for charts, links, and AI tool badges. Surfaces step cleanly from pure white (`#FFFFFF`) cards over a subtle cool-tinted canvas (`#FCF8FF`) so financial figures and status indicators stand out without heavy borders.

- **Primary & Secondary:** Indigo-Violet (`#3525CD`) drives primary CTAs and active navigation; Cobalt Blue (`#0051D5`) supports secondary actions, simulator comparisons, and chart series.
- **Semantic Status:** Emerald Green (`#15803D`) marks income and safe cashflow; Warm Amber (`#B45309`) signals reserve warnings and AI estimates; Crimson (`#BA1A1A`) marks expenses and deficit risks.
- **Surfaces:** Pure white (`#FFFFFF`) elevated cards sit on `#FCF8FF` and `#F5F2FF` containers for effortless visual grouping.

```yaml
colors:
  primary: "#3525CD"
  on-primary: "#FFFFFF"
  primary-container: "#E2DFFF"
  on-primary-container: "#0F0069"
  secondary: "#0051D5"
  on-secondary: "#FFFFFF"
  secondary-container: "#DBE1FF"
  on-secondary-container: "#00174B"
  tertiary: "#7E3000"
  on-tertiary: "#FFFFFF"
  tertiary-container: "#FFDBCC"
  on-tertiary-container: "#351000"
  success: "#15803D"
  on-success: "#FFFFFF"
  success-container: "#DCFCE7"
  on-success-container: "#14532D"
  warning: "#B45309"
  on-warning: "#FFFFFF"
  warning-container: "#FEF3C7"
  on-warning-container: "#78350F"
  error: "#BA1A1A"
  on-error: "#FFFFFF"
  error-container: "#FFDAD6"
  on-error-container: "#93000A"
  background: "#FCF8FF"
  on-background: "#1B1B24"
  surface: "#FCF8FF"
  surface-dim: "#DCD8E5"
  surface-bright: "#FCF8FF"
  surface-container-lowest: "#FFFFFF"
  surface-container-low: "#F5F2FF"
  surface-container: "#F0ECF9"
  surface-container-high: "#EAE6F4"
  surface-container-highest: "#E4E1EE"
  on-surface: "#1B1B24"
  surface-variant: "#E3E0F4"
  on-surface-variant: "#464555"
  outline: "#777587"
  outline-variant: "#C7C4D8"
  inverse-surface: "#302F39"
  inverse-on-surface: "#F3EFFC"
  inverse-primary: "#C3C0FF"
```

## Typography

**Alata** provides approachable geometric clarity for display balances and page titles. **Instrument Sans** handles all Vietnamese UI copy, labels, and transaction rows with crisp diacritic legibility. **Red Hat Mono** is reserved for tabular VND amounts, percentages, and date timestamps where vertical alignment matters.

```yaml
typography:
  display-lg:
    fontFamily: "Alata"
    fontSize: 40px
    fontWeight: 400
    lineHeight: 48px
    letterSpacing: -0.5px
  display-lg-mobile:
    fontFamily: "Alata"
    fontSize: 30px
    fontWeight: 400
    lineHeight: 36px
    letterSpacing: -0.25px
  headline-lg:
    fontFamily: "Alata"
    fontSize: 28px
    fontWeight: 400
    lineHeight: 36px
    letterSpacing: -0.25px
  headline-md:
    fontFamily: "Alata"
    fontSize: 22px
    fontWeight: 400
    lineHeight: 28px
    letterSpacing: 0px
  title-lg:
    fontFamily: "Instrument Sans"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: 0px
  title-md:
    fontFamily: "Instrument Sans"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 22px
    letterSpacing: 0px
  body-lg:
    fontFamily: "Instrument Sans"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
    letterSpacing: 0px
  body-md:
    fontFamily: "Instrument Sans"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0px
  body-sm:
    fontFamily: "Instrument Sans"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0px
  label-lg:
    fontFamily: "Instrument Sans"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
    letterSpacing: 0px
  label-md:
    fontFamily: "Instrument Sans"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 16px
    letterSpacing: 0.2px
  label-sm:
    fontFamily: "Instrument Sans"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 14px
    letterSpacing: 0.3px
  mono-lg:
    fontFamily: "Red Hat Mono"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: -0.2px
  mono-md:
    fontFamily: "Red Hat Mono"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0px
```

## Layout & Spacing

Mobile screens use a single-column fluid grid (`390px` viewport) with `16px` horizontal page margins and a fixed bottom navigation bar (`Home, Thu chi, AI, Mô phỏng`). Desktop screens (`1280px`) pair a persistent `256px` left sidebar (`Dashboard, Transactions, AI Assistant, Simulator, Settings`) with a `max-w-6xl` adaptive main content area using a 12-column CSS grid and `24px` gutters. All spacing follows a strict `4px` / `8px` base scale.

```yaml
spacing:
  gutter-xs: 4px
  gutter-sm: 8px
  gutter-md: 16px
  gutter-lg: 24px
  gutter-xl: 32px
  section: 32px
  page-margin: 16px
```

## Elevation & Depth

Hierarchy relies on tonal surface stepping (`surface` → `surface-container-low` → `surface-container-lowest` white cards) paired with crisp `1px` `outline-variant` hairline borders and subtle ambient shadows on floating sheets and primary balance cards. Heavy drop shadows and glassmorphic blurs are avoided so dense financial numbers stay sharp.

## Shapes

Cards and sheets use generous, approachable rounded corners (`16px` for cards, `24px` for modals and bottom sheets), while inputs and action buttons use `12px` and status chips use `full` pill radii.

```yaml
rounded:
  sm: 6px
  DEFAULT: 12px
  md: 12px
  lg: 16px
  xl: 24px
  full: 9999px
```

## Motion & Micro-interaction

Interactions are crisp and immediate. Button presses and tab switches respond in `120ms`; drawers, bottom sheets, and proposal cards enter in `220ms` with a decelerating curve and exit in `150ms`. Only `transform`, `opacity`, and color properties animate, and `prefers-reduced-motion` is respected.

```yaml
motion:
  state-change:
    duration: 120ms
    delay: 0ms
    timingFunction: ease-out
  surface-enter:
    duration: 220ms
    delay: 0ms
    timingFunction: cubic-bezier(0.2, 0, 0, 1)
  surface-exit:
    duration: 150ms
    delay: 0ms
    timingFunction: cubic-bezier(0.3, 0, 1, 1)
```

## Voice & Content Strategy

Copy is written in natural, friendly, practical **Vietnamese** using sentence case. The AI copilot speaks like a helpful, transparent financial partner—always framing forecasts and purchase simulations as estimates ("Ước tính", "Dự báo tham khảo") rather than guarantees, and never implying autonomous money transfers.

- **Numbers & Currency:** Use Vietnamese dot-separated thousands with `₫` or `đ` (e.g., `4.850.000 ₫`, `-45.000 ₫`, `+12.500.000 ₫`) and `tabular-nums`.
- **Actions:** Label buttons with clear verbs ("Mô phỏng", "Xác nhận", "Lưu thay đổi", "Hỏi FinPilot", "Thêm giao dịch").
- **States:** Every list and chart clearly distinguishes loading, empty, and warning states with a concrete next step.

## Components

Component implementations live as individual HTML sticker sheet files in
`components/`. Each file contains the canonical, styled HTML components with
`<!-- COMPONENT: name -->` comment markers. Read each file before use.

- **Badge** → `@components/badge.html`: `badge-numeric`, `badge-dot`
- **Button** → `@components/button.html`: `button-primary`, `button-icon`, `button-with-icon`
- **Card** → `@components/card.html`: `card-elevated`, `card-action`, `card-interactive`, `card-interactive-2`
- **Input Field** → `@components/input-field.html`: `input-field-text`, `input-field-icon`
- **Modal** → `@components/modal.html`: `modal-standard`, `modal-alert`, `modal-drawer`
