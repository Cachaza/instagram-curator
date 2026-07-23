import { db } from "@/lib/db";
import { appLocale, dictionary } from "@/lib/i18n";
import { requireAdmin } from "@/lib/session";
import { MemberForm } from "./member-form";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  await requireAdmin();
  const locale = appLocale();
  const t = dictionary(locale);
  const users = db.prepare(`
    SELECT id,name,email,role,createdAt FROM "user" ORDER BY createdAt
  `).all() as Array<{ id: string; name: string; email: string; role: string; createdAt: string }>;

  return (
    <main className="centered wide">
      <section className="setup-card">
        <p className="eyebrow">{t.members.eyebrow}</p>
        <h1>{t.members.title}</h1>
        <p className="muted">{t.members.intro}</p>
        <MemberForm locale={locale} />
        <div className="member-list">
          {users.map((user) => (
            <article key={user.id}>
              <div><strong>{user.name}</strong><small>{user.email}</small></div>
              <span className="pill">{user.role}</span>
            </article>
          ))}
        </div>
        <a className="back-link" href="/import">{t.members.back}</a>
      </section>
    </main>
  );
}
