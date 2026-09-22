import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Fraunces } from "next/font/google";
import { isClerkConfigured } from "@/lib/auth-context";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-dm-serif",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FinTrack | Personal Finance Intelligence",
  description: "Understand your spending, cash flow, and financial goals.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const content = isClerkConfigured() ? <ClerkProvider>{children}</ClerkProvider> : children;

  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${fraunces.variable}`}
    >
      <body>{content}</body>
    </html>
  );
}
