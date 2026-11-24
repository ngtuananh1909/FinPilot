import type { Metadata } from "next";
import { Alata, Instrument_Sans, Red_Hat_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

// next/font downloads and self-hosts the fonts at build time (no runtime request to Google).
const alata = Alata({ weight: "400", subsets: ["latin", "vietnamese"], variable: "--font-alata", display: "swap" });
const instrumentSans = Instrument_Sans({
  subsets: ["latin", "latin-ext"],
  variable: "--font-instrument-sans",
  display: "swap",
});
const redHatMono = Red_Hat_Mono({
  weight: ["500", "600"],
  subsets: ["latin", "latin-ext"],
  variable: "--font-red-hat-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FinPilot AI",
  description: "Trợ lý quyết định tài chính cá nhân cho sinh viên và người mới đi làm.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={`${alata.variable} ${instrumentSans.variable} ${redHatMono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
