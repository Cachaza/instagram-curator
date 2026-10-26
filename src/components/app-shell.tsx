"use client";

import { Activity, CheckSquare, Github, ListChecks, Library, MapPin, MoreHorizontal, PlusCircle, Settings, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { messages, type Locale } from "@/lib/messages";

export function AppShell({ children, locale }: { children: React.ReactNode; locale: Locale }) {
  const pathname = usePathname();
  const session = authClient.useSession();
  const t = messages[locale].shell;
  const primary = [
    { href: "/library", label: t.explore, icon: Library },
    { href: "/import", label: t.add, icon: PlusCircle },
    { href: "/review", label: t.review, icon: CheckSquare },
  ];
  const secondary = [
    { href: "/map", label: t.restaurants, icon: MapPin },
    { href: "/actions", label: t.actions, icon: ListChecks },
    { href: "/pipeline", label: t.processing, icon: Activity },
    { href: "/members", label: t.members, icon: Users },
    { href: "/setup", label: t.settings, icon: Settings },
  ];
  if (pathname === "/sign-in") return children;

  function active(href: string) { return pathname.startsWith(href); }
  function navLink({ href, label, icon: Icon }: { href: string; label: string; icon: typeof Library }) {
    return <Link key={href} href={href} className={active(href) ? "nav-active" : ""} aria-current={active(href) ? "page" : undefined}><Icon />{label}</Link>;
  }

  return (
    <div className="curator-shell">
      <a className="skip-link" href="#main-content">{t.skipToContent}</a>
      <aside className="sidebar">
        <div className="logo"><span aria-hidden="true">◩</span><strong>curator</strong></div>
        <nav aria-label={t.primaryNavigation}>{primary.map(navLink)}</nav>
        <div className="sidebar-bottom">
          <nav aria-label={t.secondaryNavigation}>{secondary.map(navLink)}</nav>
          <a href="https://github.com/Cachaza/instagram-curator" target="_blank" rel="noreferrer"><Github />{t.sourceCode}</a>
          <div className="feed-card"><Sparkles /><strong>{t.archiveTitle}</strong><span>{t.archiveBody}</span></div>
        </div>
      </aside>
      <header className="app-header">
        <Link className="mobile-brand" href="/library" aria-label={t.brandHome}><span aria-hidden="true">◩</span>curator</Link>
        <Link className="header-add" href="/import" aria-current={active("/import") ? "page" : undefined}><PlusCircle />{t.add}</Link>
        <div className="user-menu">
          <span>{session.data?.user.name ?? t.account}</span>
          <button onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/sign-in") } })}>{t.signOut}</button>
        </div>
        <details className="mobile-more" key={pathname}>
          <summary aria-label={t.openSecondaryNavigation}><MoreHorizontal /></summary>
          <nav aria-label={t.secondaryNavigation}>{secondary.map(navLink)}<a href="https://github.com/Cachaza/instagram-curator" target="_blank" rel="noreferrer"><Github />{t.sourceCode}</a><span>{session.data?.user.name ?? t.account}</span><button onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/sign-in") } })}>{t.signOut}</button></nav>
        </details>
      </header>
      <main className="app-main" id="main-content" tabIndex={-1}>{children}</main>
      <nav className="mobile-nav" aria-label={t.primaryNavigation}>{primary.map(navLink)}</nav>
    </div>
  );
}
