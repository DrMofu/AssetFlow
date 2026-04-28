import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";

import { AppShell } from "@/components/app-shell";
import { getRepository } from "@/lib/repository";
import "./globals.css";

const sans = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AssetFlow",
  description: "Personal wealth organizer with multi-currency valuation and trend tracking.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const repository = getRepository();
  const settings = await repository.getSettings();

  return (
    <html
      lang="zh-CN"
      data-theme={settings.themePreference}
      data-color-scheme={settings.colorScheme}
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body suppressHydrationWarning className="min-h-full font-sans">
        <AppShell settings={settings}>{children}</AppShell>
      </body>
    </html>
  );
}
