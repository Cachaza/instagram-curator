import type { Metadata, Viewport } from "next";
import { appLocale } from "@/lib/i18n";
import { PwaRegistration } from "@/components/pwa-registration";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Curator",
  applicationName: "Curator",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Curator", statusBarStyle: "default" },
  icons: { icon: "/icons/curator.svg", apple: "/icons/curator-192.png" },
  description: "Turn Instagram publications into private, searchable knowledge.",
};

export const viewport: Viewport = { themeColor: "#1a1d20" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await appLocale();
  return (
    <html lang={locale}>
      <body><PwaRegistration locale={locale} /><AppShell locale={locale}>{children}</AppShell></body>
    </html>
  );
}
