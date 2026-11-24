/** Shared Tailwind class strings (design tokens live in tailwind.config.ts). */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

const BUTTON_BASE =
  `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-control px-5 text-label-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;

export const BUTTON_PRIMARY = `${BUTTON_BASE} bg-primary text-on-primary hover:bg-primary/90`;
export const BUTTON_SECONDARY = `${BUTTON_BASE} border border-outline-variant bg-surface-container-lowest text-primary hover:bg-surface-container-low`;
export const BUTTON_DANGER = `${BUTTON_BASE} bg-error text-on-primary hover:bg-error/90`;
export const INPUT =
  `min-h-[44px] w-full rounded-control border border-outline bg-surface-container-lowest px-4 text-body-lg text-on-surface placeholder:text-outline ${FOCUS_RING}`;
