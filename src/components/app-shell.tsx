"use client";

import {
  Activity, BookOpen, CheckSquare, Home, Library, Menu, PlusCircle,
  Github, Search, Settings, Sparkles, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { messages, type Locale } from "@/lib/messages";

export function AppShell({ children, locale }: { children: React.ReactNode; locale: Locale }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const session = authClient.useSession();
  const t = messages[locale].shell;
  const navigation = [
    { href: "/dashboard", label: t.home, icon: Home },
    { href: "/library", label: t.explore, icon: Library },
    { href: "/review", label: t.review, icon: CheckSquare },
    { href: "/actions", label: t.actions, icon: BookOpen },
    { href: "/pipeline", label: t.processing, icon: Activity },
    { href: "/import", label: t.add, icon: PlusCircle },
  ];
  if (pathname === "/sign-in") return children;

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    router.push(query ? `/library?q=${encodeURIComponent(query)}` : "/library");
  }

  return (
    <div className="curator-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="logo"><span aria-hidden="true">◩</span><strong>curator</strong><button aria-label={t.closeNavigation} onClick={() => setMobileOpen(false)}><X /></button></div>
        <nav>
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={pathname.startsWith(href) ? "nav-active" : ""}>
              <Icon />{label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/members"><Users />{t.members}</Link>
          <Link href="/setup"><Settings />{t.settings}</Link>
          <a href="https://github.com/Cachaza/instagram-curator" target="_blank" rel="noreferrer"><Github />{t.sourceCode}</a>
          <div className="feed-card"><Sparkles /><strong>{t.archiveTitle}</strong><span>{t.archiveBody}</span></div>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-backdrop" aria-label={t.closeNavigation} onClick={() => setMobileOpen(false)} />}
      <header className="app-header">
        <button className="mobile-menu" aria-label={t.openNavigation} onClick={() => setMobileOpen(true)}><Menu /></button>
        <Link className="mobile-brand" href="/dashboard" aria-label="Curator, inicio"><span aria-hidden="true">◩</span>curator</Link>
        <form className="global-search" onSubmit={search}><Search /><input name="q" placeholder={t.searchPlaceholder} aria-label={t.search} /></form>
        <Link className="header-add" href="/import"><PlusCircle />{t.add}</Link>
        <div className="user-menu">
          <span>{session.data?.user.name ?? t.account}</span>
          <button onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/sign-in") } })}>{t.signOut}</button>
        </div>
      </header>
      <main className="app-main">{children}</main>
      <nav className="mobile-nav">
        {navigation.slice(0, 4).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={pathname.startsWith(href) ? "nav-active" : ""}><Icon /><span>{label}</span></Link>
        ))}
      </nav>
    </div>
  );
}
