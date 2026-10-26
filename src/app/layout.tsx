import type { Metadata } from "next";
import { appLocale } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Curator",
  description: "Turn Instagram publications into private, searchable knowledge.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await appLocale();
  return (
    <html lang={locale}>
      <body><AppShell locale={locale}>{children}</AppShell></body>
    </html>
  );
}
