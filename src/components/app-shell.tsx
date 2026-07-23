"use client";

import {
  Activity, BookOpen, CheckSquare, Home, Library, Menu, PlusCircle,
  Github, Search, Settings, Sparkles, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

const navigation = [
  { href: "/dashboard", label: "Inicio", icon: Home },
  { href: "/library", label: "Explorar", icon: Library },
  { href: "/review", label: "Revisar", icon: CheckSquare },
  { href: "/actions", label: "Acciones", icon: BookOpen },
  { href: "/pipeline", label: "Pipeline", icon: Activity },
  { href: "/import", label: "Añadir reel", icon: PlusCircle },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const session = authClient.useSession();
  if (pathname === "/sign-in") return children;

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    router.push(query ? `/library?q=${encodeURIComponent(query)}` : "/library");
  }

  return (
    <div className="curator-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="logo"><span>✦</span><strong>curador</strong><button onClick={() => setMobileOpen(false)}><X /></button></div>
        <nav>
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={pathname.startsWith(href) ? "nav-active" : ""}>
              <Icon />{label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Link href="/members"><Users />Miembros</Link>
          <Link href="/setup"><Settings />Ajustes</Link>
          <a href="https://github.com/Cachaza/instagram-curator" target="_blank" rel="noreferrer"><Github />Código fuente</a>
          <div className="feed-card"><Sparkles /><strong>Tu feed, pero útil.</strong><span>Todo lo que guardas, listo para volver a encontrar.</span></div>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-backdrop" aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} />}
      <header className="app-header">
        <button className="mobile-menu" onClick={() => setMobileOpen(true)}><Menu /></button>
        <form className="global-search" onSubmit={search}><Search /><input name="q" placeholder="Busca ideas, lugares, recetas…" /></form>
        <Link className="header-add" href="/import"><PlusCircle />Añadir reel</Link>
        <div className="user-menu">
          <span>{session.data?.user.name ?? "Cuenta"}</span>
          <button onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/sign-in") } })}>Salir</button>
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
