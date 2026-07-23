import { db } from "@/lib/db";
import { appLocale, dictionary } from "@/lib/i18n";
import { AuthForm } from "./auth-form";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const users = (db.prepare('SELECT COUNT(*) AS count FROM "user"').get() as { count: number }).count;
  const locale = appLocale();
  const t = dictionary(locale);
  return (
    <main className="centered">
      <section className="auth-card">
        <div className="brand-mark">IC</div>
        <p className="eyebrow">{t.auth.selfHosted}</p>
        <h1>{users === 0 ? t.auth.createAdmin : t.auth.signInTitle}</h1>
        <p className="muted">
          {users === 0
            ? t.auth.createAdminHelp
            : t.auth.signInHelp}
        </p>
        <AuthForm initialMode={users === 0 ? "sign-up" : "sign-in"} locale={locale} />
      </section>
    </main>
  );
}
