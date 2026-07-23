import { dictionary } from "@/lib/i18n";
import { recentImports } from "@/lib/imports";
import { requireSession } from "@/lib/session";
import { isSetupComplete } from "@/lib/settings";
import { redirect } from "next/navigation";
import { ImportForm } from "./import-form";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const session = await requireSession();
  if (!isSetupComplete() && session.user.role === "admin") redirect("/setup");
  const t = dictionary();
  const imports = recentImports();

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><span className="brand-dot" /> <strong>{t.appName}</strong></div>
        <nav><a className="active" href="/import">{t.import.navImport}</a><span>{t.import.navPipeline}</span><a href="/library">{t.import.navLibrary}</a>{session.user.role === "admin" && <><a href="/members">{t.import.navMembers}</a><a href="/setup">{t.import.navSettings}</a></>}</nav>
        <div className="account"><span>{session.user.name}</span><SignOutButton label={t.auth.signOut} /></div>
      </header>

      <div className="content">
        <section className="hero">
          <p className="eyebrow">{t.import.eyebrow}</p>
          <h1>{t.import.title}</h1>
          <p>{t.import.intro}</p>
          <ImportForm labels={t.import} />
        </section>

        <section>
          <div className="section-heading"><h2>{t.import.recent}</h2><span>{imports.length}</span></div>
          <div className="import-list">
            {imports.length === 0 ? <div className="empty">{t.import.empty}</div> : imports.map((item) => (
              <article key={item.id}>
                <div className={`status status-${item.processing_status}`} />
                <div><strong>{item.source_url}</strong><small>{new Date(`${item.created_at}Z`).toLocaleString()}</small></div>
                <span className="pill">{t.statuses[item.processing_status] ?? item.processing_status}</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
