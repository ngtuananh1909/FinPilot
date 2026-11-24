import type { Config } from "tailwindcss";

// Tokens ported from design/stitch/exports/v1/.../finpilot_ai_design_system.md.
// Stitch HTML is a visual reference only; components are rebuilt in React.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#3525CD",
        "on-primary": "#FFFFFF",
        "primary-container": "#E2DFFF",
        "on-primary-container": "#0F0069",
        secondary: "#0051D5",
        "secondary-container": "#DBE1FF",
        "on-secondary-container": "#00174B",
        success: "#15803D",
        "success-container": "#DCFCE7",
        "on-success-container": "#14532D",
        warning: "#B45309",
        "warning-container": "#FEF3C7",
        "on-warning-container": "#78350F",
        error: "#BA1A1A",
        "error-container": "#FFDAD6",
        "on-error-container": "#93000A",
        background: "#FCF8FF",
        surface: "#FCF8FF",
        "surface-container-lowest": "#FFFFFF",
        "surface-container-low": "#F5F2FF",
        "surface-container": "#F0ECF9",
        "surface-container-high": "#EAE6F4",
        "on-surface": "#1B1B24",
        "on-surface-variant": "#464555",
        outline: "#777587",
        "outline-variant": "#C7C4D8",
      },
      // Design-system shapes under semantic names so existing rounded-* utilities keep their size.
      borderRadius: {
        control: "12px", // inputs and buttons
        card: "16px", // cards
        sheet: "24px", // modals and bottom sheets
      },
      // Fonts are provided as CSS variables by next/font in src/app/layout.tsx.
      fontFamily: {
        display: ["var(--font-alata)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-instrument-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-red-hat-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-lg": ["40px", { lineHeight: "48px", letterSpacing: "-0.5px" }],
        "display-lg-mobile": ["30px", { lineHeight: "36px", letterSpacing: "-0.25px" }],
        "headline-md": ["22px", { lineHeight: "28px" }],
        "title-lg": ["18px", { lineHeight: "24px", fontWeight: "600" }],
        "title-md": ["16px", { lineHeight: "22px", fontWeight: "600" }],
        "body-lg": ["16px", { lineHeight: "24px" }],
        "body-md": ["14px", { lineHeight: "20px" }],
        "body-sm": ["12px", { lineHeight: "16px" }],
        "label-lg": ["14px", { lineHeight: "20px", fontWeight: "600" }],
        "label-md": ["12px", { lineHeight: "16px", letterSpacing: "0.2px", fontWeight: "600" }],
        "mono-md": ["14px", { lineHeight: "20px", fontWeight: "500" }],
      },
    },
  },
  plugins: [],
};

export default config;
