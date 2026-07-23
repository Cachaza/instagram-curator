import type { Metadata } from "next";
import { appLocale } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Curator",
  description: "Turn Instagram publications into private, searchable knowledge.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = appLocale();
  return (
    <html lang={locale}>
      <body><AppShell locale={locale}>{children}</AppShell></body>
    </html>
  );
}
