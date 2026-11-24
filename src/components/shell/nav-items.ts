export interface NavItem {
  readonly href: string;
  readonly label: string;
  /** Shown in the mobile bottom tabs. Settings is reached via the header avatar. */
  readonly mobileTab: boolean;
  readonly icon: string; // SVG path data (24x24, stroke)
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Home", mobileTab: true, icon: "M3 11l9-8 9 8M5 10v10h14V10" },
  { href: "/transactions", label: "Thu chi", mobileTab: true, icon: "M4 7h16M4 12h16M4 17h10" },
  { href: "/assistant", label: "AI", mobileTab: true, icon: "M21 12a8 8 0 01-11.5 7.2L4 20l1-4.5A8 8 0 1121 12z" },
  { href: "/simulator", label: "Mô phỏng", mobileTab: true, icon: "M4 19V9m6 10V5m6 14v-7m4 7H2" },
  { href: "/settings", label: "Cài đặt", mobileTab: false, icon: "M12 15a3 3 0 100-6 3 3 0 000 6zm7-3l2 1-2 3-2-.5-1.5 1 .2 2.2h-3.4L12 17l-1.5-1-2 .5-2-3 2-1-.2-2 -2-1 2-3 2 .5L12 7l-.2-2h3.4" },
];

export const isActivePath = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);
